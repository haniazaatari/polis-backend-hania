import React, { useEffect, useState } from "react";
import net from "../../util/net";
import CommentList from "../lists/commentList.jsx";

const TopicReport = ({ report_id, math, comments, conversation, ptptCount, formatTid, voteColors }) => {
  const [topics, setTopics] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [topicContent, setTopicContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [runInfo, setRunInfo] = useState(null);

  useEffect(() => {
    if (!report_id) return;

    // Fetch topics from Delphi
    setLoading(true);
    net
      .polisGet("/api/v3/delphi", {
        report_id: report_id,
      })
      .then((response) => {
        console.log("Delphi topics response:", response);

        if (response && response.status === "success") {
          if (response.runs && Object.keys(response.runs).length > 0) {
            // Extract topics from the most recent run
            const latestRun = Object.values(response.runs).reduce((latest, run) => {
              return !latest || new Date(run.created_at) > new Date(latest.created_at) ? run : latest;
            }, null);

            console.log("Latest run structure:", latestRun);
            console.log("Topics by layer keys:", Object.keys(latestRun.topics_by_layer || {}));
            console.log("Topics by layer type check:", typeof latestRun.topics_by_layer);
            console.log("Topics by layer direct:", latestRun.topics_by_layer);
            
            // Store run info for display
            setRunInfo({
              model_name: latestRun.model_name,
              created_date: latestRun.created_date,
              item_count: latestRun.item_count
            });
            
            // Get job UUID for section key construction
            const jobUuid = latestRun.job_uuid;
            
            // Check different possible structures for topics
            let topicsData = null;
            
            // Try different paths to find topics
            if (latestRun.topics_by_layer) {
              // Topics are organized by layer, then by cluster id
              const allTopics = [];
              console.log("Processing topics_by_layer:", latestRun.topics_by_layer);
              
              // Handle both string and numeric keys
              const layers = Object.keys(latestRun.topics_by_layer);
              console.log("Layer keys found:", layers);
              
              layers.forEach(layer => {
                const clusters = latestRun.topics_by_layer[layer];
                console.log(`Processing layer ${layer}:`, clusters);
                
                if (clusters && typeof clusters === 'object') {
                  Object.entries(clusters).forEach(([clusterId, topic]) => {
                    // Create the topic key in format layer_cluster (e.g., "0_1")
                    const topicKey = `${layer}_${clusterId}`;
                    
                    // Extract section key from topic_key, converting # to _
                    let sectionKey;
                    if (topic.topic_key && topic.topic_key.includes('#')) {
                      // Versioned format: convert uuid#layer#cluster -> uuid_layer_cluster
                      sectionKey = topic.topic_key.replace(/#/g, '_');
                    } else if (jobUuid) {
                      // Fallback: construct from jobUuid
                      sectionKey = `${jobUuid}_${layer}_${clusterId}`;
                    } else {
                      // Legacy format
                      sectionKey = topic.topic_key || `layer${layer}_${clusterId}`;
                    }
                    console.log(`Topic ${topicKey}:`, topic); // Debug log to see structure
                    console.log(`Section key: ${sectionKey}`); // Debug the section key
                    allTopics.push({
                      key: sectionKey, // Use the job UUID based section key
                      displayKey: topicKey, // For display purposes
                      name: topic.topic_name || topicKey, // Access the topic_name property
                      sortKey: parseInt(layer) * 1000 + parseInt(clusterId) // Sort by layer first, then cluster
                    });
                  });
                } else {
                  console.log(`No valid clusters found for layer ${layer}`);
                }
              });
              
              // Add global sections to the topics list
              const globalSections = [
                {
                  key: "global_groups",
                  name: "Divisive Comments (Global)",
                  sortKey: -300, // Sort before layer topics
                  isGlobal: true
                },
                {
                  key: "global_group_informed_consensus", 
                  name: "Cross-Group Consensus (Global)",
                  sortKey: -200,
                  isGlobal: true
                },
                {
                  key: "global_uncertainty",
                  name: "High Uncertainty Comments (Global)", 
                  sortKey: -100,
                  isGlobal: true
                }
              ];
              
              // Combine global sections with layer topics
              topicsData = [...globalSections, ...allTopics];
            } else if (latestRun.topics && latestRun.topics.topics) {
              // Original structure
              topicsData = Object.entries(latestRun.topics.topics)
                .map(([key, topic]) => ({
                  key,
                  name: topic.name || key,
                  sortKey: parseInt(key.split('_')[1]) || 0
                }));
            } else if (latestRun.topics) {
              // Maybe topics is directly an object
              topicsData = Object.entries(latestRun.topics)
                .map(([key, topic]) => ({
                  key,
                  name: topic.name || topic.topic || key,
                  sortKey: parseInt(key.split('_')[1]) || 0
                }));
            }
            
            if (topicsData && topicsData.length > 0) {
              // Sort topics by their numeric part
              const sortedTopics = topicsData.sort((a, b) => a.sortKey - b.sortKey);
              console.log("Found topics:", sortedTopics);
              setTopics(sortedTopics);
            } else {
              console.log("No topics found in the expected structure");
              console.log("Latest run object:", latestRun);
              console.log("Latest run keys:", Object.keys(latestRun || {}));
            }
          } else {
            console.log("No runs found in response");
            console.log("Response structure:", response);
          }
        } else {
          console.log("Response not successful or missing:", response);
        }
        setLoading(false);
      })
      .catch((error) => {
        console.error("Error fetching topics:", error);
        setLoading(false);
      });
  }, [report_id]);

  const handleTopicChange = (event) => {
    const topicKey = event.target.value;
    setSelectedTopic(topicKey);
    
    if (!topicKey) {
      setTopicContent(null);
      return;
    }

    // Fetch the specific topic report
    setContentLoading(true);
    net
      .polisGet("/api/v3/delphi/reports", {
        report_id: report_id,
        section: topicKey  // The topic key IS the section (e.g., "layer0_8")
      })
      .then((response) => {
        console.log("Topic report response:", response);
        
        if (response && response.status === "success" && response.reports) {
          // The response contains reports object with the section as key
          const sectionData = response.reports[topicKey];
          if (sectionData && sectionData.report_data) {
            // Parse the report_data if it's a string
            const reportData = typeof sectionData.report_data === 'string' 
              ? JSON.parse(sectionData.report_data) 
              : sectionData.report_data;
            setTopicContent(reportData);
          } else {
            setTopicContent({
              error: true,
              message: "No report data found for this topic"
            });
          }
        } else if (response && response.status === "error") {
          setTopicContent({
            error: true,
            message: response.message || "No narrative report available for this topic"
          });
        }
        setContentLoading(false);
      })
      .catch((error) => {
        console.error("Error fetching topic report:", error);
        setContentLoading(false);
      });
  };

  // Extract citation IDs from the topic content
  const extractCitations = (content) => {
    const citations = [];
    if (content && content.paragraphs) {
      content.paragraphs.forEach(paragraph => {
        if (paragraph.sentences) {
          paragraph.sentences.forEach(sentence => {
            if (sentence.clauses) {
              sentence.clauses.forEach(clause => {
                if (clause.citations && Array.isArray(clause.citations)) {
                  citations.push(...clause.citations.filter(c => typeof c === 'number'));
                }
              });
            }
          });
        }
      });
    }
    return [...new Set(citations)]; // Remove duplicates
  };


  const renderContent = () => {
    if (!topicContent) return null;

    // Handle error state
    if (topicContent.error) {
      return (
        <div className="topic-content">
          <p style={{ color: '#666', fontStyle: 'italic' }}>{topicContent.message}</p>
          <p style={{ color: '#666', fontSize: '14px', marginTop: '10px' }}>
            To generate narrative reports, use the "Generate Narrative Report" button in the Comments Report page.
          </p>
        </div>
      );
    }

    // Extract citations for this topic
    const citationIds = extractCitations(topicContent);
    console.log("Extracted citations:", citationIds);
    console.log("Comments loaded:", comments?.length || 0);

    // Render the topic content in the same format as the main report
    return (
      <div className="topic-layout-container">
        <div className="topic-text-content">
          <div className="topic-content">
            {topicContent.paragraphs && topicContent.paragraphs.map((paragraph, idx) => (
            <div key={idx} className="paragraph">
              <h3>{paragraph.title}</h3>
              {paragraph.sentences && paragraph.sentences.map((sentence, sIdx) => (
                <p key={sIdx}>
                  {sentence.clauses && sentence.clauses.map((clause, cIdx) => (
                    <span key={cIdx}>
                      {clause.text}
                      {clause.citations && clause.citations.length > 0 && (
                        <sup className="citations">
                          {clause.citations.join(', ')}
                        </sup>
                      )}
                      {cIdx < sentence.clauses.length - 1 && ' '}
                    </span>
                  ))}
                </p>
              ))}
            </div>
          ))}
          </div>
        </div>
        
        {/* Comments list section - side by side */}
        {citationIds.length > 0 && comments && comments.length > 0 && (
          <div className="topic-comments-column">
            <h3 style={{ marginBottom: '20px' }}>Comments Referenced in This Topic</h3>
            <CommentList
              conversation={conversation}
              ptptCount={ptptCount}
              math={math}
              formatTid={formatTid}
              tidsToRender={citationIds}
              comments={comments}
              voteColors={voteColors || {
                agree: "#21a53a",
                disagree: "#e74c3c", 
                pass: "#b3b3b3"
              }}
            />
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <div className="loading">Loading topics...</div>;
  }

  return (
    <div className="topic-report-container">
      <style>{`
        .topic-report-container {
          padding: 20px;
          font-family: Arial, sans-serif;
          max-width: 1600px;
          margin: 0 auto;
        }
        .run-info-header {
          margin-bottom: 20px;
          padding: 15px;
          background: #f5f5f5;
          border-radius: 6px;
          border-left: 4px solid #03a9f4;
        }
        .run-info-header h3 {
          margin: 0 0 8px 0;
          color: #333;
        }
        .run-meta {
          display: flex;
          gap: 15px;
          align-items: center;
          font-size: 14px;
          color: #666;
        }
        .run-date {
          color: #666;
        }
        .topic-selector {
          margin-bottom: 30px;
        }
        .topic-selector select {
          width: 100%;
          max-width: 800px;
          padding: 10px;
          font-size: 16px;
          border: 1px solid #ccc;
          border-radius: 4px;
          background-color: white;
        }
        .topic-layout-container {
          display: flex;
          flex-direction: row;
          gap: 20px;
        }
        .topic-text-content {
          flex-grow: 0;
          flex-shrink: 1;
          flex-basis: 520px;
        }
        .topic-content {
          background: #f9f9f9;
          padding: 20px;
          border-radius: 8px;
          line-height: 1.6;
        }
        .topic-content h3 {
          color: #333;
          margin-top: 20px;
          margin-bottom: 10px;
        }
        .topic-content h3:first-child {
          margin-top: 0;
        }
        .topic-content p {
          margin-bottom: 15px;
          color: #555;
        }
        .citations {
          color: #0066cc;
          font-size: 0.85em;
          margin-left: 2px;
        }
        .topic-comments-column {
          flex-grow: 1;
          flex-shrink: 1;
          flex-basis: 0%;
          min-width: 400px;
        }
        .loading {
          text-align: center;
          padding: 20px;
          color: #666;
        }
        
        /* Responsive stacking for smaller screens */
        @media (max-width: 992px) {
          .topic-layout-container {
            flex-direction: column;
          }
          
          .topic-text-content,
          .topic-comments-column {
            flex-basis: auto;
            width: 100%;
          }
          
          .topic-comments-column {
            margin-top: 30px;
          }
        }
      `}</style>
      
      {/* Run Information Header */}
      {runInfo && (
        <div className="run-info-header">
          <h3>Topic Analysis Report</h3>
          <div className="run-meta">
            <span>Model: {runInfo.model_name}</span>
            <span className="run-date">
              Generated: {runInfo.created_date}
            </span>
            <span>{runInfo.item_count} topics total</span>
          </div>
        </div>
      )}
      
      <div className="topic-selector">
        <select 
          value={selectedTopic} 
          onChange={handleTopicChange}
          disabled={contentLoading}
        >
          <option value="">Select a report section...</option>
          
          {/* Global sections */}
          {topics.filter(topic => topic.isGlobal).length > 0 && (
            <optgroup label="Global Analysis">
              {topics.filter(topic => topic.isGlobal).map(topic => (
                <option key={topic.key} value={topic.key}>
                  {topic.name}
                </option>
              ))}
            </optgroup>
          )}
          
          {/* Layer topics grouped by layer */}
          {Object.entries(
            topics
              .filter(topic => !topic.isGlobal)
              .reduce((groups, topic) => {
                const layer = topic.displayKey ? topic.displayKey.split('_')[0] : '0';
                if (!groups[layer]) groups[layer] = [];
                groups[layer].push(topic);
                return groups;
              }, {})
          ).map(([layer, layerTopics]) => (
            <optgroup key={layer} label={`Layer ${layer} Topics`}>
              {layerTopics.map(topic => (
                <option key={topic.key} value={topic.key}>
                  {topic.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {contentLoading && (
        <div className="loading">Loading topic report...</div>
      )}

      {!contentLoading && renderContent()}
    </div>
  );
};

export default TopicReport;