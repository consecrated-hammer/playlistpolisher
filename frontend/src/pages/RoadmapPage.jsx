import React, { useState, useEffect } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

const RoadmapPage = () => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchRoadmap = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(
          'https://raw.githubusercontent.com/consecrated-hammer/playlistpolisher/main/ROADMAP.md'
        );
        
        if (!response.ok) {
          throw new Error(`Failed to fetch roadmap: ${response.status}`);
        }
        
        const text = await response.text();
        setContent(text);
      } catch (err) {
        console.error('Error fetching roadmap:', err);
        setError('Unable to load roadmap. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchRoadmap();
  }, []);

  const parseMarkdown = (markdown) => {
    const lines = markdown.split('\n');
    const sections = [];
    let currentSection = null;
    let currentSubsection = null;
    let currentContent = [];

    lines.forEach((line) => {
      // H2 sections (##) - Main categories
      if (line.startsWith('## ') && !line.startsWith('### ')) {
        // Flush current subsection if exists
        if (currentSubsection) {
          currentSubsection.content = currentContent.join('\n');
          currentContent = [];
        }
        
        // Flush current section if exists
        if (currentSection) {
          sections.push(currentSection);
        }
        
        currentSection = {
          title: line.replace('## ', '').trim(),
          content: '',
          subsections: [],
          id: line.replace('## ', '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        };
        currentSubsection = null;
      }
      // H3 subsections (###)
      else if (line.startsWith('### ')) {
        // Flush previous subsection if exists
        if (currentSubsection) {
          currentSubsection.content = currentContent.join('\n');
          currentSection.subsections.push(currentSubsection);
          currentContent = [];
        }
        
        currentSubsection = {
          title: line.replace('### ', '').trim(),
          content: '',
          id: line.replace('### ', '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        };
      }
      // Content lines
      else if (currentSubsection) {
        currentContent.push(line);
      } else if (currentSection) {
        if (!currentSection.content) {
          currentSection.content = line;
        } else {
          currentSection.content += '\n' + line;
        }
      }
    });

    // Flush last subsection
    if (currentSubsection && currentSection) {
      currentSubsection.content = currentContent.join('\n');
      currentSection.subsections.push(currentSubsection);
    }
    
    // Push last section
    if (currentSection) {
      sections.push(currentSection);
    }

    return sections;
  };

  const renderContent = (text) => {
    if (!text) return null;

    const lines = text.split('\n');
    const elements = [];
    let currentList = [];
    let inList = false;

    const flushList = () => {
      if (currentList.length > 0) {
        elements.push(
          <ul key={`list-${elements.length}`} className="space-y-2 ml-6 mb-4">
            {currentList.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-white">
                <span className="text-spotify-green mt-1">•</span>
                <span dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(item) }} />
              </li>
            ))}
          </ul>
        );
        currentList = [];
        inList = false;
      }
    };

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      
      if (!trimmed && !inList) {
        return; // Skip empty lines outside lists
      }

      // Subheadings (### or **)
      if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
        flushList();
        const text = trimmed.slice(2, -2);
        elements.push(
          <h4 key={`subhead-${idx}`} className="text-base font-semibold text-white mb-2 mt-4">
            {text}
          </h4>
        );
      }
      // Bullet list items
      else if (trimmed.startsWith('- ')) {
        inList = true;
        currentList.push(trimmed.slice(2));
      }
      // Regular paragraph
      else if (trimmed) {
        flushList();
        if (!trimmed.startsWith('>') && !trimmed.startsWith('---')) {
          elements.push(
            <p
              key={`p-${idx}`}
              className="text-spotify-gray-light mb-3 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(trimmed) }}
            />
          );
        }
      }
    });

    flushList();
    return elements;
  };

  const formatInlineMarkdown = (text) => {
    return text
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
      // Inline code
      .replace(/`(.+?)`/g, '<code class="bg-spotify-gray-mid px-2 py-0.5 rounded text-sm text-spotify-green">$1</code>')
      // Italics
      .replace(/\*(.+?)\*/g, '<em class="text-spotify-gray-light italic">$1</em>');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <ErrorMessage message={error} />
      </div>
    );
  }

  const sections = parseMarkdown(content);
  const filteredSections = sections.filter(s => 
    !s.title.includes('Roadmap') && s.title !== 'Note'
  );
  const noteSection = sections.find(s => s.title === 'Note');

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 animate-fade-in">
      {/* Header */}
      <div className="bg-gradient-to-br from-spotify-gray-dark via-spotify-gray-mid to-spotify-gray-dark border border-spotify-gray-mid/60 rounded-2xl p-8 shadow-2xl mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-spotify-green text-spotify-black flex items-center justify-center shadow-lg">
            <span className="icon text-2xl">map</span>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-spotify-green font-semibold">What's Coming</p>
            <h1 className="text-3xl font-bold text-white">Development Roadmap</h1>
          </div>
        </div>
        <p className="text-spotify-gray-light leading-relaxed">
          Planned features and improvements for Playlist Polisher. These are ideas under consideration—no timeline or guarantees, but feedback is welcome!
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-6">
        {filteredSections.map((section) => (
          <div
            key={section.id}
            id={section.id}
            className="bg-spotify-gray-dark/70 border border-spotify-gray-mid rounded-2xl p-6 shadow-xl hover:border-spotify-gray-light/30 transition-colors"
          >
            {/* Section Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-spotify-gray-mid text-spotify-green flex items-center justify-center">
                <span className="icon text-xl">
                  {section.title.includes('Issue') ? 'warning' :
                   section.title.includes('Organise') || section.title.includes('Organize') ? 'sort' :
                   section.title.includes('Manage') ? 'tune' :
                   section.title.includes('Automation') ? 'schedule' :
                   'label'}
                </span>
              </div>
              <h2 className="text-xl font-bold text-white">{section.title}</h2>
            </div>

            {/* Section Description */}
            {section.content && (
              <div className="ml-13 mb-4">
                {renderContent(section.content)}
              </div>
            )}

            {/* Subsections */}
            {section.subsections && section.subsections.length > 0 && (
              <div className="ml-13 space-y-6">
                {section.subsections.map((subsection) => (
                  <div key={subsection.id} id={subsection.id} className="border-l-2 border-spotify-green/30 pl-4">
                    <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                      <span className="text-spotify-green">▸</span>
                      {subsection.title}
                    </h3>
                    <div className="space-y-2">
                      {renderContent(subsection.content)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer Note */}
      {noteSection && (
        <div className="mt-8 bg-spotify-gray-mid/40 border border-spotify-gray-mid rounded-xl p-6">
          <div className="flex items-start gap-3">
            <span className="icon text-amber-300 text-xl">info</span>
            <div className="text-sm text-spotify-gray-light leading-relaxed">
              {renderContent(noteSection.content)}
            </div>
          </div>
        </div>
      )}

      {/* Source Link */}
      <div className="mt-6 text-center">
        <a
          href="https://github.com/consecrated-hammer/playlistpolisher/blob/main/ROADMAP.md"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-spotify-gray-light hover:text-white transition-colors"
        >
          <span className="icon text-base">open_in_new</span>
          View source on GitHub
        </a>
      </div>
    </div>
  );
};

export default RoadmapPage;
