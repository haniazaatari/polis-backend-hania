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
              <h3>Top Topics by Vote Density and Consensus</h3>
              <p style={{ marginBottom: 15, fontSize: "0.9em", color: "#666" }}>
                Topics ranked by vote density (engagement) and overall consensus (lower divisiveness = higher agreement)
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
                    
                    // Sort by divisiveness (lower = more consensus)
                    const divisiveA = a.stats.divisiveness || 0;
                    const divisiveB = b.stats.divisiveness || 0;
                    return divisiveA - divisiveB;
                  })
                  .slice(0, 10);
                
                return (
                  <ol style={{ margin: 0, paddingLeft: 25 }}>
                    {topTopics.map((item, index) => (
                      <li key={`${item.layerId}-${item.clusterId}`} style={{ marginBottom: 8 }}>
                        <strong>{item.topic.topic_name}</strong> (Layer {item.layerId})
                        <div style={{ fontSize: "0.85em", color: "#666", marginTop: 2 }}>
                          Vote Density: {item.stats.vote_density?.toFixed(1) || 0} votes/comment | 
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
                      <th style={{ padding: "10px", textAlign: "right" }} title="Overall vote split (0=consensus, 1=even split)">Divisiveness</th>
                      <th style={{ padding: "10px", textAlign: "center" }}>Action</th>
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
                        
                        // Then by divisiveness (ascending - lower divisiveness = more consensus)
                        return a.stats.divisiveness - b.stats.divisiveness;
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
                            {stats.divisiveness !== undefined ? stats.divisiveness.toFixed(2) : '-'}
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
                                onClick={() => console.log('Create collective statement for topic:', topic.topic_name, topic.topic_key)}
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
            ))}
          </div>
        )}
        
        <Footer />
      </div>
    </div>
  );
};

export default TopicStats;