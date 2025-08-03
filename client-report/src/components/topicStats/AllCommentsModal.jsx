import React, { useState, useEffect } from 'react';
import AllCommentsScatterplot from './visualizations/AllCommentsScatterplot.jsx';

const AllCommentsModal = ({ 
  isOpen, 
  onClose, 
  topicName, 
  topicKey, 
  topicStats,
  comments,
  math,
  voteColors
}) => {
  const [topicComments, setTopicComments] = useState([]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && topicStats && comments) {
      // Get comments for this topic
      const commentTids = topicStats.comment_tids || [];
      const topicCommentsData = comments.filter(c => commentTids.includes(c.tid));
      setTopicComments(topicCommentsData);
    }
  }, [isOpen, topicStats, comments]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}
    onClick={onClose}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        width: '1000px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
      onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '20px',
          borderBottom: '1px solid #e0e0e0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h2 style={{ margin: 0 }}>{topicName} - Comments Analysis</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '5px'
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px'
        }}>
          <p style={{ marginBottom: '20px', color: '#666' }}>
            Visualization of all comments in this topic showing group-aware consensus vs. total votes.
            Each dot represents a comment. Hover for details.
          </p>
          
          {topicComments.length > 0 ? (
            <AllCommentsScatterplot 
              comments={topicComments} 
              math={math} 
              voteColors={voteColors} 
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
              No comments to display
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AllCommentsModal;