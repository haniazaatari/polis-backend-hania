import React, { useState, useEffect } from "react";
import net from "../../util/net";
import { useReportId } from "../framework/useReportId";
import Heading from "../framework/heading.jsx";
import Footer from "../framework/Footer.jsx";

const TopicStats = ({ conversation, report_id: propsReportId }) => {
  const { report_id } = useReportId(propsReportId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topicsData, setTopicsData] = useState(null);
  const [statsData, setStatsData] = useState(null);

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
            
            {/* Overall ranking section */}
            <div style={{ marginTop: 30, marginBottom: 40, padding: 20, backgroundColor: "#f5f5f5", borderRadius: 5 }}>
              <h3>Top Topics by Vote Density and Divisiveness</h3>
              <p style={{ marginBottom: 15, fontSize: "0.9em", color: "#666" }}>
                Topics ranked by vote density (engagement) and group-aware consensus (lower consensus = more divisive)
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
                  .filter(item => item.stats.vote_density > 0)
                  .sort((a, b) => {
                    const densityA = a.stats.vote_density || 0;
                    const densityB = b.stats.vote_density || 0;
                    if (densityA !== densityB) return densityB - densityA;
                    
                    const consensusA = a.stats.group_aware_consensus || 1;
                    const consensusB = b.stats.group_aware_consensus || 1;
                    return consensusA - consensusB;
                  })
                  .slice(0, 10);
                
                return (
                  <ol style={{ margin: 0, paddingLeft: 25 }}>
                    {topTopics.map((item, index) => (
                      <li key={`${item.layerId}-${item.clusterId}`} style={{ marginBottom: 8 }}>
                        <strong>{item.topic.topic_name}</strong> (Layer {item.layerId})
                        <div style={{ fontSize: "0.85em", color: "#666", marginTop: 2 }}>
                          Vote Density: {item.stats.vote_density?.toFixed(1) || 0} votes/comment | 
                          Group Consensus: {item.stats.group_aware_consensus !== undefined ? `${(item.stats.group_aware_consensus * 100).toFixed(1)}%` : 'N/A'} | 
                          Divisiveness: {item.stats.divisiveness?.toFixed(2) || 0}
                        </div>
                      </li>
                    ))}
                  </ol>
                );
              })()}
            </div>
            
            {Object.entries(latestRun.topics_by_layer || {}).map(([layerId, topics]) => (
              <div key={layerId} style={{ marginTop: 30 }}>
                <h3>Layer {layerId}</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #333" }}>
                      <th style={{ padding: "10px", textAlign: "left" }}>Topic</th>
                      <th style={{ padding: "10px", textAlign: "right" }}>Comments</th>
                      <th style={{ padding: "10px", textAlign: "right" }}>Total Votes</th>
                      <th style={{ padding: "10px", textAlign: "right" }}>Vote Density</th>
                      <th style={{ padding: "10px", textAlign: "right" }}>Group Consensus</th>
                      <th style={{ padding: "10px", textAlign: "right" }}>Divisiveness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(topics)
                      .map(([clusterId, topic]) => ({
                        clusterId,
                        topic,
                        stats: statsData?.[topic.topic_key] || {}
                      }))
                      .sort((a, b) => {
                        // Sort by vote density first (descending)
                        const densityA = a.stats.vote_density || 0;
                        const densityB = b.stats.vote_density || 0;
                        if (densityA !== densityB) return densityB - densityA;
                        
                        // Then by group consensus (ascending - lower consensus = more divisive)
                        const consensusA = a.stats.group_aware_consensus || 0;
                        const consensusB = b.stats.group_aware_consensus || 0;
                        return consensusA - consensusB;
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
                            {stats.group_aware_consensus !== undefined ? `${(stats.group_aware_consensus * 100).toFixed(1)}%` : '-'}
                          </td>
                          <td style={{ padding: "10px", textAlign: "right" }}>
                            {stats.divisiveness !== undefined ? stats.divisiveness.toFixed(2) : '-'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
        
        <Footer />
      </div>
    </div>
  );
};

export default TopicStats;