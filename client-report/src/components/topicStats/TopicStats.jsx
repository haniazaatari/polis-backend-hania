import React, { useState, useEffect } from "react";
import net from "../../util/net";
import { useReportId } from "../framework/useReportId";
import Heading from "../framework/heading.jsx";
import Footer from "../framework/Footer.jsx";
import CollectiveStatementModal from "./CollectiveStatementModal.jsx";
import TopicScatterplot from "../topicScatterplot/TopicScatterplot.jsx";

const TopicStats = ({ conversation, report_id: propsReportId, math, comments, ptptCount, formatTid, voteColors }) => {
  const { report_id } = useReportId(propsReportId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topicsData, setTopicsData] = useState(null);
  const [statsData, setStatsData] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'comment_count', direction: 'desc' });
  
  // Color gradient function: green-red vertical, grey-saturated horizontal
  const createColorGradient = (consensus, avgVotes, maxVotes) => {
    // Normalize votes to 0-1 range for saturation
    const voteSaturation = Math.min(avgVotes / maxVotes, 1);
    
    // Consensus determines green (high) to red (low)
    // Using HSL: H=120 is green, H=0 is red
    const hue = consensus * 120; // 0-120 range
    
    // Saturation based on vote density (0% = grey, 100% = full color)
    const saturation = voteSaturation * 100;
    
    // Keep lightness constant for visibility
    const lightness = 50;
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };

  const handleSort = (key) => {
    setSortConfig(prevConfig => ({
      key,
      direction: prevConfig.key === key && prevConfig.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  useEffect(() => {
    if (!report_id) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch topics from Delphi endpoint
        const topicsResponse = await net.polisGet("/api/v3/delphi", {
          report_id: report_id,
        });
        
        // Fetch topic statistics
        const statsResponse = await net.polisGet("/api/v3/topicStats", {
          report_id: report_id,
        });
        
        if (topicsResponse.status === "success") {
          setTopicsData(topicsResponse.runs);
        }
        
        if (statsResponse.status === "success") {
          setStatsData(statsResponse.stats);
        }
        
        setLoading(false);
      } catch (err) {
        console.error("Error fetching topic stats:", err);
        setError(err.message || "Failed to load topic statistics");
        setLoading(false);
      }
    };

    fetchData();
  }, [report_id]);

  if (loading) {
    return (
      <div style={{ margin: "0px 10px", maxWidth: "1200px", padding: "20px" }}>
        <Heading conversation={conversation} />
        <div style={{ marginTop: 40 }}>
          <p>Loading topic statistics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ margin: "0px 10px", maxWidth: "1200px", padding: "20px" }}>
        <Heading conversation={conversation} />
        <div style={{ marginTop: 40 }}>
          <p>Error: {error}</p>
        </div>
      </div>
    );
  }

  // Get the most recent run of topics
  const latestRunKey = Object.keys(topicsData || {}).sort().reverse()[0];
  const latestRun = topicsData?.[latestRunKey];

  return (
    <div style={{ margin: "0px 10px", maxWidth: "1200px", padding: "20px" }} data-testid="topic-stats">
      <Heading conversation={conversation} />
      <div style={{ marginTop: 40 }}>
        <h2>Topic Statistics</h2>
        
        {latestRun && (
          <div style={{ marginTop: 20 }}>
            <p>Model: {latestRun.model_name}</p>
            <p>Generated: {new Date(latestRun.created_at).toLocaleString()}</p>
            
            {/* Scatterplot visualization */}
            {statsData && (
              <div style={{ marginTop: 30, marginBottom: 40, padding: 20, backgroundColor: "#f5f5f5", borderRadius: 8 }}>
                <h3>Topic Overview: Vote Consensus</h3>
                <p style={{ marginBottom: 15, fontSize: "0.9em", color: "#666" }}>
                  <strong>Y-axis (Topic Consensus):</strong> Measures vote alignment within each topic. 
                  High values (near 1.0) mean most people either agree OR disagree consistently. 
                  Low values (near 0.0) mean votes are evenly split.<br />
                  <strong>X-axis:</strong> Average votes per comment | <strong>Bubble size:</strong> Number of comments<br />
                  <strong>Colors:</strong> <span style={{ color: "#008000" }}>Green</span> = high consensus, 
                  <span style={{ color: "#ff0000" }}> Red</span> = low consensus, 
                  <span style={{ color: "#808080" }}> Grey</span> = few votes
                </p>
                <TopicScatterplot
                  data={(() => {
                    const scatterData = [];
                    let maxVotes = 0;
                    Object.entries(latestRun.topics_by_layer || {}).forEach(([layerId, topics]) => {
                      Object.entries(topics).forEach(([clusterId, topic]) => {
                        const stats = statsData[topic.topic_key] || {};
                        if (stats.comment_count > 0) {
                          const avgVotes = stats.vote_density || 0;
                          maxVotes = Math.max(maxVotes, avgVotes);
                          scatterData.push({
                            topic_name: topic.topic_name,
                            consensus: stats.divisiveness !== undefined ? (1 - stats.divisiveness) : 0,
                            avg_votes_per_comment: avgVotes,
                            comment_count: stats.comment_count || 0,
                            layer: layerId,
                            topic_key: topic.topic_key
                          });
                        }
                      });
                    });
                    // Add max votes to each item for color calculation
                    return scatterData.map(d => ({ ...d, maxVotes }));
                  })()}
                  config={{
                    height: 400,
                    bubbleOpacity: 0.8,
                    colorFunction: (d) => createColorGradient(d.consensus, d.avg_votes_per_comment, d.maxVotes)
                  }}
                  onClick={(topic) => {
                    setSelectedTopic({ name: topic.topic_name, key: topic.topic_key });
                    setModalOpen(true);
                  }}
                />
              </div>
            )}
            
            {/* Group-aware consensus scatterplot */}
            {statsData && math && math["group-aware-consensus"] && (
              <div style={{ marginTop: 30, marginBottom: 40, padding: 20, backgroundColor: "#f5f5f5", borderRadius: 8 }}>
                <h3>Topic Overview: Group-Aware Consensus</h3>
                <p style={{ marginBottom: 15, fontSize: "0.9em", color: "#666" }}>
                  <strong>Y-axis (Group-Aware Consensus):</strong> Measures agreement across different participant groups from PCA2. 
                  Higher values indicate topics where groups tend to vote similarly (cross-group agreement).<br />
                  <strong>X-axis:</strong> Average votes per comment | <strong>Bubble size:</strong> Number of comments<br />
                  <strong>Colors:</strong> <span style={{ color: "#008000" }}>Green</span> = high group consensus, 
                  <span style={{ color: "#ff0000" }}> Red</span> = low group consensus, 
                  <span style={{ color: "#808080" }}> Grey</span> = few votes
                </p>
                <TopicScatterplot
                  data={(() => {
                    const scatterData = [];
                    let maxVotes = 0;
                    Object.entries(latestRun.topics_by_layer || {}).forEach(([layerId, topics]) => {
                      Object.entries(topics).forEach(([clusterId, topic]) => {
                        const stats = statsData[topic.topic_key] || {};
                        
                        // Calculate average group consensus for this topic
                        let groupConsensus = null;
                        if (stats.comment_tids) {
                          const consensusValues = stats.comment_tids
                            .map(tid => math["group-aware-consensus"][tid])
                            .filter(val => val !== undefined);
                          
                          if (consensusValues.length > 0) {
                            groupConsensus = consensusValues.reduce((sum, val) => sum + val, 0) / consensusValues.length;
                          }
                        }
                        
                        if (stats.comment_count > 0 && groupConsensus !== null) {
                          const avgVotes = stats.vote_density || 0;
                          maxVotes = Math.max(maxVotes, avgVotes);
                          scatterData.push({
                            topic_name: topic.topic_name,
                            consensus: groupConsensus,
                            avg_votes_per_comment: avgVotes,
                            comment_count: stats.comment_count || 0,
                            layer: layerId,
                            topic_key: topic.topic_key
                          });
                        }
                      });
                    });
                    // Add max votes to each item for color calculation
                    return scatterData.map(d => ({ ...d, maxVotes }));
                  })()}
                  config={{
                    height: 400,
                    bubbleOpacity: 0.8,
                    yAxisLabel: "Group-Aware Consensus",
                    colorFunction: (d) => createColorGradient(d.consensus, d.avg_votes_per_comment, d.maxVotes)
                  }}
                  onClick={(topic) => {
                    setSelectedTopic({ name: topic.topic_name, key: topic.topic_key });
                    setModalOpen(true);
                  }}
                />
              </div>
            )}
            
            {/* Overall ranking section */}
            <div style={{ marginTop: 30, marginBottom: 40, padding: 20, backgroundColor: "#f5f5f5", borderRadius: 5 }}>
              <h3>Top Topics by Comment Count</h3>
              <p style={{ marginBottom: 15, fontSize: "0.9em", color: "#666" }}>
                Topics ranked by number of comments (size) and overall consensus
              </p>
              {(() => {
                // Collect all topics across layers
                const allTopics = [];
                Object.entries(latestRun.topics_by_layer || {}).forEach(([layerId, topics]) => {
                  Object.entries(topics).forEach(([clusterId, topic]) => {
                    const stats = statsData?.[topic.topic_key] || {};
                    allTopics.push({
                      layerId,
                      clusterId,
                      topic,
                      stats
                    });
                  });
                });
                
                // Sort and take top 10
                const topTopics = allTopics
                  .filter(item => item.stats.comment_count > 0)
                  .sort((a, b) => {
                    // Sort by comment count (descending)
                    const commentsA = a.stats.comment_count || 0;
                    const commentsB = b.stats.comment_count || 0;
                    if (commentsA !== commentsB) return commentsB - commentsA;
                    
                    // Then by consensus (descending)
                    const consensusA = a.stats.divisiveness !== undefined ? (1 - a.stats.divisiveness) : 0;
                    const consensusB = b.stats.divisiveness !== undefined ? (1 - b.stats.divisiveness) : 0;
                    return consensusB - consensusA;
                  })
                  .slice(0, 10);
                
                return (
                  <ol style={{ margin: 0, paddingLeft: 25 }}>
                    {topTopics.map((item, index) => (
                      <li key={`${item.layerId}-${item.clusterId}`} style={{ marginBottom: 8 }}>
                        <strong>{item.topic.topic_name}</strong> (Layer {item.layerId})
                        <div style={{ fontSize: "0.85em", color: "#666", marginTop: 2 }}>
                          Avg Votes/Comment: {item.stats.vote_density?.toFixed(1) || 0} | 
                          Consensus: {item.stats.divisiveness !== undefined ? (1 - item.stats.divisiveness).toFixed(2) : '-'}
                        </div>
                      </li>
                    ))}
                  </ol>
                );
              })()}
            </div>
            
            {(() => {
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
                <h3 style={{ whiteSpace: "pre-line" }}>{layerLabel}</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #333" }}>
                      <th style={{ padding: "10px", textAlign: "left", cursor: "pointer", userSelect: "none" }} 
                          onClick={() => handleSort('topic_name')}>
                        Topic {sortConfig.key === 'topic_name' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                      </th>
                      <th style={{ padding: "10px", textAlign: "right", cursor: "pointer", userSelect: "none" }} 
                          title="Overall agreement level (1.00=full consensus, 0.00=even split)"
                          onClick={() => handleSort('consensus')}>
                        Topic Consensus {sortConfig.key === 'consensus' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
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
                          case 'consensus':
                            aValue = a.stats.divisiveness !== undefined ? (1 - a.stats.divisiveness) : 0;
                            bValue = b.stats.divisiveness !== undefined ? (1 - b.stats.divisiveness) : 0;
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
                          <td style={{ padding: "10px" }}>{topic.topic_name}</td>
                          <td style={{ padding: "10px", textAlign: "right" }}>
                            {stats.divisiveness !== undefined ? (1 - stats.divisiveness).toFixed(2) : '-'}
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
                            {stats.divisiveness !== undefined && stats.divisiveness < 0.2 && stats.total_votes > 50 ? (
                              <button 
                                style={{
                                  backgroundColor: "#4CAF50",
                                  color: "white",
                                  border: "none",
                                  padding: "5px 10px",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                  fontSize: "0.85em"
                                }}
                                onClick={() => {
                                  setSelectedTopic({ name: topic.topic_name, key: topic.topic_key });
                                  setModalOpen(true);
                                }}
                              >
                                Create Collective Statement
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              );
            });
          })()}
          </div>
        )}
        
        <Footer />
      </div>
      
      <CollectiveStatementModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedTopic(null);
        }}
        topicName={selectedTopic?.name}
        topicKey={selectedTopic?.key}
        reportId={report_id}
        conversation={conversation}
        math={math}
        comments={comments}
        ptptCount={ptptCount}
        formatTid={formatTid}
        voteColors={voteColors}
      />
    </div>
  );
};

export default TopicStats;