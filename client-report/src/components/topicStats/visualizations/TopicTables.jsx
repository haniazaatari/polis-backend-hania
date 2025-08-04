import React, { useState } from 'react';

const TopicTables = ({ latestRun, statsData, math, onTopicSelect, onScatterplot, onBeeswarm, onLayerDistribution, onViewTopic }) => {
  const [sortConfig, setSortConfig] = useState({ key: 'comment_count', direction: 'desc' });
  
  const handleSort = (key) => {
    setSortConfig(prevConfig => ({
      key,
      direction: prevConfig.key === key && prevConfig.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const layerEntries = Object.entries(latestRun.topics_by_layer || {});
  const totalLayers = layerEntries.length;
  
  return layerEntries
    .sort(([a], [b]) => parseInt(b) - parseInt(a)) // Sort layers in descending order
    .map(([layerId, topics]) => {
      const topicCount = Object.keys(topics).length;
      const layerNum = parseInt(layerId);
      
      // Dynamic layer naming based on position
      let layerName = "";
      let layerDescription = "";
      
      if (layerNum === 0) {
        layerName = "Finer Grained";
        layerDescription = "(Specific insights)";
      } else if (layerNum === totalLayers - 1) {
        layerName = "Coarse";
        layerDescription = "(Big picture themes)";
      } else {
        layerName = "Medium";
        layerDescription = "(Balanced overview)";
      }
      
      const layerLabel = `${layerName}: ${topicCount} Topics\n${layerDescription}`;
      
      return (
        <div key={layerId} style={{ marginTop: 30 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ whiteSpace: "pre-line", margin: 0 }}>{layerLabel}</h3>
            <button 
              style={{
                backgroundColor: "#9C27B0",
                color: "white",
                border: "none",
                padding: "5px 10px",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.85em"
              }}
              onClick={() => onLayerDistribution({ layerId, layerName, topics })}
              title="View distribution of consensus across topics"
            >
              Boxplots
            </button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #333" }}>
                <th style={{ padding: "10px", textAlign: "left", cursor: "pointer", userSelect: "none" }} 
                    onClick={() => handleSort('topic_name')}>
                  Topic {sortConfig.key === 'topic_name' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                </th>
                <th style={{ padding: "10px", textAlign: "right", cursor: "pointer", userSelect: "none" }}
                    onClick={() => handleSort('comment_count')}>
                  Comments {sortConfig.key === 'comment_count' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                </th>
                <th style={{ padding: "10px", textAlign: "right", cursor: "pointer", userSelect: "none" }}
                    onClick={() => handleSort('total_votes')}>
                  Total Votes {sortConfig.key === 'total_votes' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                </th>
                <th style={{ padding: "10px", textAlign: "right", cursor: "pointer", userSelect: "none" }}
                    onClick={() => handleSort('vote_density')}>
                  Avg Votes/Comment {sortConfig.key === 'vote_density' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                </th>
                <th style={{ padding: "10px", textAlign: "right", cursor: "pointer", userSelect: "none" }}
                    onClick={() => handleSort('group_consensus')}
                    title="Group-aware consensus from PCA2">
                  Group Consensus {sortConfig.key === 'group_consensus' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                </th>
                <th style={{ padding: "10px", textAlign: "center" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(topics)
                .map(([clusterId, topic]) => {
                  const stats = statsData?.[topic.topic_key] || {};
                  
                  // Calculate average group consensus for this topic
                  let groupConsensus = null;
                  if (math && math["group-aware-consensus"] && stats.comment_tids) {
                    const consensusValues = stats.comment_tids
                      .map(tid => math["group-aware-consensus"][tid])
                      .filter(val => val !== undefined);
                    
                    if (consensusValues.length > 0) {
                      groupConsensus = consensusValues.reduce((sum, val) => sum + val, 0) / consensusValues.length;
                    }
                  }
                  
                  return {
                    clusterId,
                    topic,
                    stats: { ...stats, group_consensus: groupConsensus }
                  };
                })
                .sort((a, b) => {
                  let aValue, bValue;
                  
                  switch (sortConfig.key) {
                    case 'topic_name':
                      aValue = a.topic.topic_name.toLowerCase();
                      bValue = b.topic.topic_name.toLowerCase();
                      break;
                    case 'comment_count':
                      aValue = a.stats.comment_count || 0;
                      bValue = b.stats.comment_count || 0;
                      break;
                    case 'total_votes':
                      aValue = a.stats.total_votes || 0;
                      bValue = b.stats.total_votes || 0;
                      break;
                    case 'vote_density':
                      aValue = a.stats.vote_density || 0;
                      bValue = b.stats.vote_density || 0;
                      break;
                    case 'group_consensus':
                      aValue = a.stats.group_consensus || 0;
                      bValue = b.stats.group_consensus || 0;
                      break;
                    default:
                      aValue = a.stats.comment_count || 0;
                      bValue = b.stats.comment_count || 0;
                  }
                  
                  if (sortConfig.direction === 'asc') {
                    return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
                  } else {
                    return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
                  }
                })
                .map(({ clusterId, topic, stats }) => (
                  <tr key={clusterId} style={{ borderBottom: "1px solid #ccc" }}>
                    <td style={{ padding: "10px" }}>
                      <a 
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          onViewTopic({ name: topic.topic_name, key: topic.topic_key });
                        }}
                        style={{
                          color: "#0066cc",
                          textDecoration: "none",
                          cursor: "pointer"
                        }}
                        onMouseEnter={(e) => e.target.style.textDecoration = "underline"}
                        onMouseLeave={(e) => e.target.style.textDecoration = "none"}
                      >
                        {topic.topic_name}
                      </a>
                    </td>
                    <td style={{ padding: "10px", textAlign: "right" }}>{stats.comment_count || 0}</td>
                    <td style={{ padding: "10px", textAlign: "right" }}>{stats.total_votes || 0}</td>
                    <td style={{ padding: "10px", textAlign: "right" }}>
                      {stats.vote_density !== undefined ? stats.vote_density.toFixed(1) : '-'}
                    </td>
                    <td style={{ padding: "10px", textAlign: "right" }}>
                      {stats.group_consensus !== null ? stats.group_consensus.toFixed(2) : '-'}
                    </td>
                    <td style={{ padding: "10px", textAlign: "center" }}>
                      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center' }}>
                        <button 
                          style={{
                            backgroundColor: "transparent",
                            color: "#666",
                            border: "1px solid #ccc",
                            padding: "4px 8px",
                            borderRadius: "3px",
                            cursor: "pointer",
                            fontSize: "0.85em"
                          }}
                          onClick={() => onTopicSelect({ name: topic.topic_name, key: topic.topic_key })}
                        >
                          Collective Statement
                        </button>
                        
                        <button 
                          style={{
                            backgroundColor: "transparent",
                            color: "#666",
                            border: "1px solid #ccc",
                            padding: "4px 8px",
                            borderRadius: "3px",
                            cursor: "pointer",
                            fontSize: "0.85em"
                          }}
                          onClick={() => onScatterplot({ name: topic.topic_name, key: topic.topic_key })}
                          title="View votes"
                        >
                          Votes
                        </button>
                        
                        <button 
                          style={{
                            backgroundColor: "transparent",
                            color: "#666",
                            border: "1px solid #ccc",
                            padding: "4px 8px",
                            borderRadius: "3px",
                            cursor: "pointer",
                            fontSize: "0.85em"
                          }}
                          onClick={() => onBeeswarm({ name: topic.topic_name, key: topic.topic_key })}
                          title="View beeswarm"
                        >
                          Beeswarm
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      );
    });
};

export default TopicTables;