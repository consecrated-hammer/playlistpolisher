import React from 'react';
import { Link } from 'react-router-dom';
import { SHOW_DONATION } from '../config';

const Footer = () => {
  return (
    <footer className="mt-auto border-t border-spotify-gray-mid bg-spotify-black/60 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          {/* Copyright and Disclaimer */}
          <div className="text-center md:text-left">
            <p className="text-sm text-white mb-1">
              © 2025 Playlist Polisher. All rights reserved.
            </p>
            <p className="text-xs text-spotify-gray-light">
              Playlist Polisher is an independent service and is not affiliated with, endorsed by, or sponsored by Spotify AB.
            </p>
          </div>

          {/* Links */}
          <nav className="flex flex-wrap justify-center gap-4 md:gap-6 text-sm">
            <Link 
              to="/roadmap" 
              className="text-spotify-gray-light hover:text-spotify-green transition-colors"
            >
              Roadmap
            </Link>
            {SHOW_DONATION && (
              <a 
                href="https://github.com/sponsors/consecrated-hammer" 
                target="_blank"
                rel="noopener noreferrer"
                className="text-spotify-green hover:text-spotify-green-dark transition-colors flex items-center gap-1"
              >
                <span className="icon text-base">favorite</span>
                Support
              </a>
            )}
            <a 
              href="https://github.com/consecrated-hammer/playlistpolisher" 
              target="_blank"
              rel="noopener noreferrer"
              className="text-spotify-gray-light hover:text-spotify-green transition-colors"
            >
              GitHub
            </a>
            <Link 
              to="/terms" 
              className="text-spotify-gray-light hover:text-spotify-green transition-colors"
            >
              Terms
            </Link>
            <Link 
              to="/privacy" 
              className="text-spotify-gray-light hover:text-spotify-green transition-colors"
            >
              Privacy
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
