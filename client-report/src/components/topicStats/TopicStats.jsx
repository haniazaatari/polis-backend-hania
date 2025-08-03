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
  
  // Calculate metrics from comments data
  const calculateMetricsFromComments = (commentTids, allComments) => {
    if (!commentTids || !allComments) return null;
    
    // Create a map for quick lookup
    const commentMap = {};
    allComments.forEach(c => {
      commentMap[c.tid] = c;
    });
    
    let totalVotes = 0;
    let totalAgree = 0;
    let totalDisagree = 0;
    let totalPass = 0;
    let consensusSum = 0;
    let divisiveSum = 0;
    let commentCount = 0;
    
    commentTids.forEach(tid => {
      const comment = commentMap[tid];
      if (!comment) return;
      
      commentCount++;
      const agreeCount = comment.agree_count || 0;
      const disagreeCount = comment.disagree_count || 0;
      const passCount = comment.pass_count || 0;
      const voteCount = agreeCount + disagreeCount + passCount;
      
      totalVotes += voteCount;
      totalAgree += agreeCount;
      totalDisagree += disagreeCount;
      totalPass += passCount;
      
      // Calculate per-comment consensus
      const activeVotes = agreeCount + disagreeCount;
      if (activeVotes > 0) {
        const agreeRate = agreeCount / activeVotes;
        const disagreeRate = disagreeCount / activeVotes;
        const consensus = Math.max(agreeRate, disagreeRate);
        consensusSum += consensus * voteCount;
        
        // Divisiveness: how evenly split the votes are
        const divisiveness = 1 - Math.abs(agreeRate - disagreeRate);
        divisiveSum += divisiveness * voteCount;
      }
    });
    
    return {
      comment_count: commentCount,
      total_votes: totalVotes,
      consensus: totalVotes > 0 ? consensusSum / totalVotes : 0,
      divisiveness: totalVotes > 0 ? divisiveSum / totalVotes : 0,
      agree_votes: totalAgree,
      disagree_votes: totalDisagree,
      pass_votes: totalPass,
      vote_density: commentCount > 0 ? totalVotes / commentCount : 0,
    };
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
        
        if (statsResponse.status === "success" && comments) {
          // Calculate metrics client-side using comments data
          const enrichedStats = {};
          Object.entries(statsResponse.stats).forEach(([topicKey, stats]) => {
            const metrics = calculateMetricsFromComments(stats.comment_tids, comments);
            enrichedStats[topicKey] = {
              ...stats,
              ...metrics,
              comment_tids: stats.comment_tids
            };
          });
          setStatsData(enrichedStats);
        }
        
        setLoading(false);
      } catch (err) {
        console.error("Error fetching topic stats:", err);
        setError(err.message || "Failed to load topic statistics");
        setLoading(false);
      }
    };

    fetchData();
  }, [report_id, comments]);

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
            
            
            {/* Individual comments scatterplot */}
            {comments && math && math["group-aware-consensus"] && (
              <div style={{ marginTop: 30, marginBottom: 40, padding: 20, backgroundColor: "#e8f4f8", borderRadius: 8 }}>
                <h3>All Comments: Group-Aware Consensus</h3>
                <p style={{ marginBottom: 15, fontSize: "0.9em", color: "#666" }}>
                  <strong>Y-axis (Group-Aware Consensus):</strong> Measures agreement across different participant groups from PCA2. 
                  Higher values indicate comments where groups tend to vote similarly (cross-group agreement).<br />
                  <strong>X-axis:</strong> Total votes | <strong>Bubble size:</strong> Fixed (all comments equal)<br />
                  <strong>Colors:</strong> <span style={{ color: voteColors?.agree || "#21a53a" }}>Green</span> = high group consensus, 
                  <span style={{ color: voteColors?.disagree || "#e74c3c" }}> Red</span> = low group consensus
                </p>
                <TopicScatterplot
                  data={(() => {
                    const scatterData = [];
                    let minConsensus = Infinity;
                    let maxConsensus = -Infinity;
                    
                    comments.forEach(comment => {
                      const groupConsensus = math["group-aware-consensus"][comment.tid];
                      if (groupConsensus !== undefined) {
                        const totalVotes = (comment.agree_count || 0) + (comment.disagree_count || 0) + (comment.pass_count || 0);
                        
                        // Track min/max consensus for color scaling
                        minConsensus = Math.min(minConsensus, groupConsensus);
                        maxConsensus = Math.max(maxConsensus, groupConsensus);
                        
                        scatterData.push({
                          topic_name: `Comment ${comment.tid}: ${comment.txt.substring(0, 50)}...`,
                          consensus: groupConsensus,
                          avg_votes_per_comment: totalVotes, // Using total votes for x-axis
                          comment_count: 1, // Fixed size for all comments
                          comment_id: comment.tid,
                          full_text: comment.txt
                        });
                      }
                    });
                    
                    // Fix edge case where no data
                    if (minConsensus === Infinity) {
                      minConsensus = 0;
                      maxConsensus = 1;
                    }
                    
                    // Add consensus extents to each item for color calculation
                    return scatterData.map(d => ({ ...d, minConsensus, maxConsensus }));
                  })()}
                  config={{
                    height: 600,
                    bubbleOpacity: 0.6,
                    xTransform: 'sqrt',
                    yTransform: 'pow2',
                    yAxisLabel: "Group-Aware Consensus",
                    xAxisLabel: "Total Votes",
                    useColorScale: true,
                    colorScale: [[0, '#e74c3c'], [0.5, '#f1c40f'], [1, '#21a53a']],
                    minBubbleSize: 8,
                    maxBubbleSize: 8  // Fixed size for all comments
                  }}
                  onClick={(comment) => {
                    console.log('Comment clicked:', comment);
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
                  <strong>Colors:</strong> <span style={{ color: voteColors?.agree || "#21a53a" }}>Green</span> = high group consensus, 
                  <span style={{ color: voteColors?.disagree || "#e74c3c" }}> Red</span> = low group consensus
                </p>
                <TopicScatterplot
                  data={(() => {
                    const scatterData = [];
                    let minConsensus = Infinity;
                    let maxConsensus = -Infinity;
                    
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
                          
                          // Track min/max consensus for color scaling
                          minConsensus = Math.min(minConsensus, groupConsensus);
                          maxConsensus = Math.max(maxConsensus, groupConsensus);
                          
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
                    
                    // Fix edge case where no data
                    if (minConsensus === Infinity) {
                      minConsensus = 0;
                      maxConsensus = 1;
                    }
                    
                    
                    // Add consensus extents to each item for color calculation
                    return scatterData.map(d => ({ ...d, minConsensus, maxConsensus }));
                  })()}
                  config={{
                    height: 600,
                    bubbleOpacity: 0.8,
                    xTransform: 'sqrt',
                    yTransform: 'pow2',
                    yAxisLabel: "Group-Aware Consensus",
                    useColorScale: true,
                    colorScale: [[0, '#e74c3c'], [0.5, '#f1c40f'], [1, '#21a53a']]
                  }}
                  onClick={(topic) => {
                    setSelectedTopic({ name: topic.topic_name, key: topic.topic_key });
                    setModalOpen(true);
                  }}
                />
              </div>
            )}
            
            
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
                          <td style={{ padding: "10px" }}>{topic.topic_name}</td>
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