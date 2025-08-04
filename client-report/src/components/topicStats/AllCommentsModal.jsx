import React, { useState, useEffect } from 'react';
import AllCommentsScatterplot from './visualizations/AllCommentsScatterplot.jsx';
import CommentList from '../lists/commentList.jsx';

const AllCommentsModal = ({ 
  isOpen, 
  onClose, 
  topicName, 
  topicKey, 
  topicStats,
  comments,
  math,
  conversation,
  ptptCount,
  formatTid,
  voteColors
}) => {
  const [topicComments, setTopicComments] = useState([]);
  const [sortedByConsensus, setSortedByConsensus] = useState([]);

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
    if (isOpen && topicStats && comments && math) {
      // Get comments for this topic
      const commentTids = topicStats.comment_tids || [];
      const topicCommentsData = comments.filter(c => commentTids.includes(c.tid));
      
      // Sort by group-aware consensus
      const commentsWithConsensus = topicCommentsData.map(comment => ({
        ...comment,
        groupConsensus: math["group-aware-consensus"]?.[comment.tid] || 0
      }));
      
      const sorted = [...commentsWithConsensus].sort((a, b) => 
        b.groupConsensus - a.groupConsensus
      );
      
      setTopicComments(topicCommentsData);
      setSortedByConsensus(sorted);
    }
  }, [isOpen, topicStats, comments, math]);

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
          {/* Statistics Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '20px',
            marginBottom: '30px'
          }}>
            <div style={{ 
              padding: '15px', 
              backgroundColor: '#f5f5f5', 
              borderRadius: '8px' 
            }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>
                {topicStats?.comment_count || 0}
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>Comments</div>
            </div>
            
            <div style={{ 
              padding: '15px', 
              backgroundColor: '#f5f5f5', 
              borderRadius: '8px' 
            }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>
                {(topicStats?.total_votes || 0).toLocaleString()}
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>Total Votes</div>
            </div>
            
            <div style={{ 
              padding: '15px', 
              backgroundColor: '#f5f5f5', 
              borderRadius: '8px' 
            }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>
                {(topicStats?.vote_density || 0).toFixed(1)}
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>Avg Votes/Comment</div>
            </div>
            
            <div style={{ 
              padding: '15px', 
              backgroundColor: '#e8f4e8', 
              borderRadius: '8px' 
            }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: voteColors?.agree || '#46a546' }}>
                {topicStats?.total_votes > 0 ? ((topicStats.agree_votes / topicStats.total_votes) * 100).toFixed(0) : 0}%
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>Agree ({(topicStats?.agree_votes || 0).toLocaleString()})</div>
            </div>
            
            <div style={{ 
              padding: '15px', 
              backgroundColor: '#fce8e8', 
              borderRadius: '8px' 
            }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: voteColors?.disagree || '#e74c3c' }}>
                {topicStats?.total_votes > 0 ? ((topicStats.disagree_votes / topicStats.total_votes) * 100).toFixed(0) : 0}%
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>Disagree ({(topicStats?.disagree_votes || 0).toLocaleString()})</div>
            </div>
            
            <div style={{ 
              padding: '15px', 
              backgroundColor: '#f0f0f0', 
              borderRadius: '8px' 
            }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#999' }}>
                {topicStats?.total_votes > 0 ? ((topicStats.pass_votes / topicStats.total_votes) * 100).toFixed(0) : 0}%
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>Pass ({(topicStats?.pass_votes || 0).toLocaleString()})</div>
            </div>
          </div>

          {/* Scatterplot */}
          <div style={{ marginBottom: '30px' }}>
            <h3>Comments: Group-Aware Consensus vs. Votes</h3>
            <p style={{ marginBottom: '20px', color: '#666', fontSize: '14px' }}>
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

          {/* Comments List */}
          <div>
            <h3>Comments (sorted by group consensus)</h3>
            <div style={{ marginTop: '20px' }}>
              {sortedByConsensus.map(comment => (
                <div key={comment.tid} style={{
                  padding: '15px',
                  marginBottom: '10px',
                  backgroundColor: '#fff',
                  border: '1px solid #e0e0e0',
                  borderRadius: '8px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <span style={{ 
                      fontSize: '12px', 
                      color: '#666',
                      fontWeight: 'bold'
                    }}>
                      Group Consensus: {comment.groupConsensus.toFixed(3)}
                    </span>
                    <span style={{ fontSize: '12px', color: '#666' }}>
                      {comment.agree_count} agree, {comment.disagree_count} disagree, {comment.pass_count} pass
                    </span>
                  </div>
                  <CommentList
                    conversation={conversation}
                    ptptCount={ptptCount}
                    math={math}
                    formatTid={formatTid}
                    tidsToRender={[comment.tid]}
                    comments={comments}
                    voteColors={voteColors}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AllCommentsModal;