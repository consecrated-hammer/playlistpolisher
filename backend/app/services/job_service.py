"""
Job management service for playlist sorting operations.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import logging

from app.db.database import get_db_connection

logger = logging.getLogger(__name__)


class SortJobService:
    """Service for managing playlist sort jobs."""
    
    @staticmethod
    def create_job(
        playlist_id: str,
        user_id: str,
        sort_by: str,
        direction: str,
        method: str,
        total_tracks: int,
        tracks_to_move: int,
        estimated_time: int
    ) -> str:
        """
        Create a new sort job.
        
        Returns:
            job_id: Unique identifier for the job
        """
        job_id = f"sort_{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc).isoformat()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO sort_jobs (
                    job_id, playlist_id, user_id, sort_by, direction, method,
                    status, progress, total, started_at, updated_at,
                    tracks_to_move, estimated_time, message
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                job_id, playlist_id, user_id, sort_by, direction, method,
                'pending', 0, total_tracks, now, now,
                tracks_to_move, estimated_time, 'Sort job created'
            ))
            conn.commit()
        
        logger.info(f"Created sort job {job_id} for playlist {playlist_id}")
        return job_id
    
    @staticmethod
    def get_job(job_id: str) -> Optional[Dict[str, Any]]:
        """Get job details by job_id."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM sort_jobs WHERE job_id = ?", (job_id,))
            row = cursor.fetchone()
            
            if row:
                return dict(row)
            return None
    
    @staticmethod
    def get_active_job_for_playlist(playlist_id: str) -> Optional[Dict[str, Any]]:
        """
        Get any active sort job for a playlist.
        
        Jobs stuck in 'pending' are considered stale based on playlist size:
        - < 100 tracks: 2 minutes
        - 100-500 tracks: 5 minutes
        - 500-1000 tracks: 10 minutes
        - > 1000 tracks: 15 minutes
        """
        from datetime import timedelta
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM sort_jobs 
                WHERE playlist_id = ? 
                AND status IN ('pending', 'in_progress')
                ORDER BY started_at DESC
                LIMIT 1
            """, (playlist_id,))
            row = cursor.fetchone()
            
            if row:
                job = dict(row)
                
                # Check if pending job is stale
                if job['status'] == 'pending':
                    started_at = datetime.fromisoformat(job['started_at'])
                    now = datetime.now(timezone.utc)
                    age = now - started_at
                    
                    # Calculate timeout based on playlist size
                    total_tracks = job.get('total', 0)
                    if total_tracks < 100:
                        timeout_minutes = 2
                    elif total_tracks < 500:
                        timeout_minutes = 5
                    elif total_tracks < 1000:
                        timeout_minutes = 10
                    else:
                        timeout_minutes = 15
                    
                    if age > timedelta(minutes=timeout_minutes):
                        # Mark as failed
                        logger.warning(
                            f"Job {job['job_id']} stuck in pending for {age.total_seconds():.0f}s "
                            f"({total_tracks} tracks, timeout {timeout_minutes}m), marking as failed"
                        )
                        SortJobService.update_job(
                            job['job_id'],
                            status='failed',
                            error='Job timed out - did not start within expected timeframe',
                            message='Job failed to start'
                        )
                        return None  # Don't return stale job
                
                return job
            return None
    
    @staticmethod
    def update_job(
        job_id: str,
        status: Optional[str] = None,
        progress: Optional[int] = None,
        message: Optional[str] = None,
        error: Optional[str] = None,
        total: Optional[int] = None
    ) -> bool:
        """Update job status and progress."""
        now = datetime.now(timezone.utc).isoformat()
        
        updates = ["updated_at = ?"]
        params = [now]
        
        if status is not None:
            updates.append("status = ?")
            params.append(status)
            
            # Set completed_at when job finishes
            if status in ('completed', 'failed', 'cancelled'):
                updates.append("completed_at = ?")
                params.append(now)
        
        if progress is not None:
            updates.append("progress = ?")
            params.append(progress)
        
        if message is not None:
            updates.append("message = ?")
            params.append(message)
        
        if error is not None:
            updates.append("error = ?")
            params.append(error)
        
        if total is not None:
            updates.append("total = ?")
            params.append(total)
        
        params.append(job_id)
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(f"""
                UPDATE sort_jobs 
                SET {', '.join(updates)}
                WHERE job_id = ?
            """, params)
            conn.commit()
            
            return cursor.rowcount > 0
    
    @staticmethod
    def cancel_job(job_id: str) -> bool:
        """Cancel a running job."""
        return SortJobService.update_job(
            job_id,
            status='cancelled',
            message='Job cancelled by user'
        )
    
    @staticmethod
    def get_recent_jobs(user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent jobs for a user."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM sort_jobs 
                WHERE user_id = ?
                ORDER BY started_at DESC
                LIMIT ?
            """, (user_id, limit))
            
            return [dict(row) for row in cursor.fetchall()]
    
    @staticmethod
    def get_user_active_job_count(user_id: str) -> int:
        """Count how many jobs this user currently has running/queued."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT COUNT(*) FROM sort_jobs 
                WHERE user_id = ? 
                AND status IN ('pending', 'in_progress')
            """, (user_id,))
            count = cursor.fetchone()[0]
            return count
    
    @staticmethod
    def get_pending_job_count() -> int:
        """Get total number of pending jobs across all users."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT COUNT(*) FROM sort_jobs 
                WHERE status = 'pending'
            """)
            return cursor.fetchone()[0]
    
    @staticmethod
    def cleanup_old_jobs(days: int = 7) -> int:
        """Delete completed jobs older than specified days."""
        cutoff = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        cutoff = cutoff.isoformat()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                DELETE FROM sort_jobs 
                WHERE status IN ('completed', 'failed', 'cancelled')
                AND completed_at < datetime(?, '-' || ? || ' days')
            """, (cutoff, days))
            conn.commit()
            
            deleted = cursor.rowcount
            if deleted > 0:
                logger.info(f"Cleaned up {deleted} old sort jobs")
            
            return deleted
    
    @staticmethod
    def recover_interrupted_jobs() -> int:
        """Mark interrupted jobs (from restart) as failed."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE sort_jobs 
                SET status = 'failed',
                    error = 'Service restarted while job was running',
                    message = 'Job interrupted by service restart',
                    updated_at = ?,
                    completed_at = ?
                WHERE status IN ('pending', 'in_progress')
            """, (datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat()))
            conn.commit()
            
            recovered = cursor.rowcount
            if recovered > 0:
                logger.warning(f"Marked {recovered} interrupted jobs as failed")
            
            return recovered
