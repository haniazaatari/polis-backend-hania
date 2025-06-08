import React, { useState, useEffect } from "react";
import net from "../../util/net";
import { useReportId } from "../framework/useReportId";
import getNarrativeJSON from "../../util/getNarrativeJSON";
import CommentList from "../lists/commentList.jsx";

const CommentsReport = ({ math, comments, conversation, ptptCount, formatTid, voteColors }) => {
  const { report_id } = useReportId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topics, setTopics] = useState({});
  const [runs, setRuns] = useState({});
  const [selectedRunKey, setSelectedRunKey] = useState(null);
  const [visualizationJobs, setVisualizationJobs] = useState([]);
  const [visualizationsLoading, setVisualizationsLoading] = useState(true);
  const [narrativeReports, setNarrativeReports] = useState({});
  const [narrativeLoading, setNarrativeLoading] = useState(true);
  const [narrativeRunInfo, setNarrativeRunInfo] = useState(null);
  const [jobFormOpen, setJobFormOpen] = useState(false);
  const [jobFormData, setJobFormData] = useState({
    job_type: "FULL_PIPELINE",
    priority: 50,
    max_votes: "",
    batch_size: "",
    model: "claude-opus-4-20250514",
    include_topics: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobCreationResult, setJobCreationResult] = useState(null);
  const [batchReportLoading, setBatchReportLoading] = useState(false);
  const [batchReportResult, setBatchReportResult] = useState(null);
  const [selectedLayer, setSelectedLayer] = useState(0);
  const [selectedReportSection, setSelectedReportSection] = useState("");

  useEffect(() => {
    if (!report_id) return;

    setLoading(true);
    // Fetch LLM topics from Delphi endpoint
    net
      .polisGet("/api/v3/delphi", {
        report_id: report_id,
      })
      .then((response) => {
        console.log("Delphi response:", response);

        if (response && response.status === "success") {
          if (response.runs && Object.keys(response.runs).length > 0) {
            // Set the runs data
            setRuns(response.runs);

            // Select the first (most recent) run by default
            const runKeys = Object.keys(response.runs);
            setSelectedRunKey(runKeys[0]);
          } else if (response.available_tables) {
            setError(
              `DynamoDB connected but the required table doesn't exist yet. This is normal until the Delphi pipeline has been run for this conversation.`
            );
          } else if (response.error) {
            setError(`Error: ${response.error}`);
          } else {
            setError("No LLM topic data available yet");
          }
        } else {
          setError("Failed to retrieve LLM topics");
        }

        setLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching LLM topics:", err);
        setError("Failed to connect to the Delphi endpoint");
        setLoading(false);
      });

    // Fetch visualizations from the new endpoint
    setVisualizationsLoading(true);
    net
      .polisGet("/api/v3/delphi/visualizations", {
        report_id: report_id,
      })
      .then((response) => {
        console.log("Visualizations response:", response);

        if (response && response.status === "success" && response.jobs) {
          setVisualizationJobs(response.jobs);
        }

        setVisualizationsLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching visualizations:", err);
        setVisualizationsLoading(false);
      });

    // Fetch narrative reports from Delphi
    setNarrativeLoading(true);
    net
      .polisGet("/api/v3/delphi/reports", {
        report_id: report_id,
      })
      .then((response) => {
        console.log("Narrative reports response:", response);

        if (response && response.status === "success" && response.reports) {
          setNarrativeReports(response.reports);

          // Store run info
          if (response.available_runs) {
            setNarrativeRunInfo({
              current_job_id: response.current_job_id, // Changed from current_run
              available: response.available_runs,
            });

            // Log available runs info
            if (response.available_runs.length > 1) {
              console.log(
                `Found ${response.available_runs.length} narrative report runs:`,
                response.available_runs
              );
              console.log(
                `Currently showing run for job_id: ${response.current_job_id}`
              );
            }
          }
        }

        setNarrativeLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching narrative reports:", err);
        setNarrativeLoading(false);
      });
  }, [report_id]);

  // Handle job form input changes
  const handleJobFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setJobFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  // Handle job form submission
  const handleJobFormSubmit = (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setJobCreationResult(null);

    // Send request to create a new job
    net
      .polisPost("/api/v3/delphi/jobs", {
        report_id: report_id,
        ...jobFormData,
      })
      .then((response) => {
        console.log("Job creation response:", response);

        if (response && response.status === "success") {
          setJobCreationResult({
            success: true,
            message: `Job created successfully with ID: ${response.job_id}`,
            job_id: response.job_id,
          });
        } else {
          throw new Error(response?.error || "Unknown error creating job");
        }

        // Refresh visualizations list after a slight delay
        setTimeout(() => {
          // Fetch visualizations to get the new job
          net
            .polisGet("/api/v3/delphi/visualizations", {
              report_id: report_id,
            })
            .then((response) => {
              if (response && response.status === "success" && response.jobs) {
                setVisualizationJobs(response.jobs);
              }
            })
            .catch((err) => {
              console.error("Error refreshing visualizations:", err);
            });
        }, 2000);
      })
      .catch((err) => {
        console.error("Error creating job:", err);
        setJobCreationResult({
          success: false,
          message: `Error creating job: ${err.message || "Unknown error"}`,
        });
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  // Toggle job form visibility
  const toggleJobForm = () => {
    setJobFormOpen(!jobFormOpen);
    // Reset result message when closing the form
    if (jobFormOpen) {
      setJobCreationResult(null);
    }
  };

  // Handle generate narrative report button click
  const handleGenerateNarrativeReport = () => {
    setBatchReportLoading(true);
    setBatchReportResult(null);

    // Send request to generate batch report
    net
      .polisPost("/api/v3/delphi/batchReports", {
        report_id: report_id,
        model: "claude-opus-4-20250514",
        no_cache: false,
      })
      .then((response) => {
        console.log("Batch report response:", response);

        if (response && response.status === "success") {
          setBatchReportResult({
            success: true,
            message: `Batch report generation started. Batch ID: ${response.batch_id || "N/A"}`,
            batch_id: response.batch_id,
          });
        } else {
          throw new Error(response?.error || "Unknown error generating batch report");
        }
      })
      .catch((err) => {
        console.error("Error generating batch report:", err);
        setBatchReportResult({
          success: false,
          message: `Error generating batch report: ${err.message || "Unknown error"}`,
        });
      })
      .finally(() => {
        setBatchReportLoading(false);
      });
  };

  // Get the current selected run data
  const selectedRun = selectedRunKey ? runs[selectedRunKey] : null;

  // Helper function to find the best job to display (prioritize completed jobs with visualizations)
  const getBestVisualizationJob = () => {
    if (!visualizationJobs || visualizationJobs.length === 0) {
      return null;
    }

    // First, try to find a completed job with visualizations
    const completedJobWithViz = visualizationJobs.find(job => 
      job.status === "COMPLETED" && 
      job.visualizations && 
      Array.isArray(job.visualizations) && 
      job.visualizations.length > 0
    );
    
    if (completedJobWithViz) {
      return completedJobWithViz;
    }
    
    // If no completed job with visualizations, return the first job
    return visualizationJobs[0];
  };

  // Get available layers with topic counts from visualization data
  const getAvailableLayers = () => {
    const bestJob = getBestVisualizationJob();
    if (!bestJob || !bestJob.visualizations) {
      return [];
    }

    const layerMap = new Map();
    
    // Get layers from visualizations
    bestJob.visualizations
      .filter((vis) => vis && vis.type === "interactive")
      .forEach((vis) => {
        layerMap.set(vis.layerId, { layerId: vis.layerId, topicCount: 0 });
      });

    // Add topic counts from selected run data
    if (selectedRun && selectedRun.topics_by_layer) {
      Object.keys(selectedRun.topics_by_layer).forEach((layerId) => {
        const numLayerId = parseInt(layerId);
        const topicCount = Object.keys(selectedRun.topics_by_layer[layerId]).length;
        if (layerMap.has(numLayerId)) {
          layerMap.set(numLayerId, { layerId: numLayerId, topicCount });
        }
      });
    }

    return Array.from(layerMap.values()).sort((a, b) => a.layerId - b.layerId);
  };

  const availableLayers = getAvailableLayers();

  // Get available report sections for dropdown
  const getAvailableReportSections = () => {
    if (!narrativeReports || Object.keys(narrativeReports).length === 0) {
      return [];
    }

    // Order of sections to display
    const sectionOrder = ["group_informed_consensus", "groups", "uncertainty"];
    
    // Topic sections will have names in format: layer0_0, layer0_1, etc.
    const topicSections = Object.keys(narrativeReports)
      .filter((key) => key.match(/^layer\d+_\d+$/))
      .sort((a, b) => {
        // Parse layer and topic numbers for proper numeric sorting
        const [layerA, topicA] = a.match(/layer(\d+)_(\d+)/).slice(1).map(Number);
        const [layerB, topicB] = b.match(/layer(\d+)_(\d+)/).slice(1).map(Number);
        
        // Sort by layer first, then by topic number
        if (layerA !== layerB) return layerA - layerB;
        return topicA - topicB;
      });

    // Combine ordered sections with topic sections
    const orderedSections = [...sectionOrder, ...topicSections];

    return orderedSections
      .filter(sectionKey => narrativeReports[sectionKey]) // Only include sections that exist
      .map(sectionKey => {
        const report = narrativeReports[sectionKey];
        
        // Create a human-readable section title
        let sectionTitle = sectionKey
          .replace("group_informed_consensus", "Group Consensus")
          .replace("groups", "Group Differences")
          .replace("uncertainty", "Areas of Uncertainty");

        // For topic sections in new format: layer0_0, layer0_1, etc.
        if (sectionKey.match(/^layer\d+_\d+$/)) {
          const match = sectionKey.match(/^layer(\d+)_(\d+)$/);
          const layerId = match[1];
          const clusterId = match[2];

          // Check metadata first
          if (report.metadata && report.metadata.topic_name) {
            sectionTitle = report.metadata.topic_name;
          } else if (
            selectedRun &&
            selectedRun.topics_by_layer &&
            selectedRun.topics_by_layer[layerId] &&
            selectedRun.topics_by_layer[layerId][clusterId]
          ) {
            // Try to find the topic name from selectedRun data
            sectionTitle = selectedRun.topics_by_layer[layerId][clusterId].topic_name;
          } else {
            // Fallback to a generic title
            sectionTitle = `Layer ${layerId}, Topic ${clusterId}`;
          }
        }

        return {
          key: sectionKey,
          title: sectionTitle
        };
      });
  };

  const availableReportSections = getAvailableReportSections();

  // Handle report section selection change
  const handleReportSectionChange = (event) => {
    setSelectedReportSection(event.target.value);
  };

  // Render layer switching buttons
  const renderLayerSwitcher = () => {
    if (availableLayers.length <= 1) {
      return null; // Don't show switcher if only one layer
    }

    return (
      <div className="layer-switcher">
        <h3>Layer Selection</h3>
        <p className="switcher-description">
          Choose visualization granularity: Layer 0 shows finest-grained topics, higher layers show broader groupings.
        </p>
        <div className="layer-buttons">
          {availableLayers.map((layer) => (
            <button
              key={layer.layerId}
              className={`layer-button ${selectedLayer === layer.layerId ? 'active' : ''}`}
              onClick={() => setSelectedLayer(layer.layerId)}
            >
              Layer {layer.layerId}: {layer.topicCount} Topic{layer.topicCount !== 1 ? 's' : ''}
              <span className="layer-description">
                {layer.layerId === 0 ? ' (Finest)' : 
                 layer.layerId === availableLayers[availableLayers.length - 1].layerId ? ' (Coarsest)' : 
                 ' (Medium)'}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  // Render topic cards for a layer
  const renderTopicCards = (layerId) => {
    if (!selectedRun || !selectedRun.topics_by_layer || !selectedRun.topics_by_layer[layerId]) {
      return <p>No topics found for this layer</p>;
    }

    const layerTopics = selectedRun.topics_by_layer[layerId];
    return (
      <div className="topics-grid">
        {Object.keys(layerTopics).map((clusterId) => {
          const topic = layerTopics[clusterId];
          // Skip topics that are clearly errors (like "Here are the topic labels:")
          if (
            topic.topic_name.toLowerCase().includes("here are the topic") ||
            topic.topic_name.toLowerCase().includes("topic label")
          ) {
            return null;
          }

          return (
            <div key={`${layerId}-${clusterId}`} className="topic-card">
              <h3>{topic.topic_name}</h3>
              <p>Group {clusterId}</p>
              <p className="topic-meta">
                Generated by {topic.model_name} on {topic.created_at.substring(0, 10)}
              </p>
            </div>
          );
        })}
      </div>
    );
  };

  // Render job creation form
  const renderJobCreationForm = () => {
    return (
      <div className="job-creation-form-container">
        <div className="form-header">
          <h3>Create New Delphi Job</h3>
          <button className="close-button" onClick={toggleJobForm} aria-label="Close form">
            &times;
          </button>
        </div>

        {jobCreationResult && (
          <div className={`result-message ${jobCreationResult.success ? "success" : "error"}`}>
            {jobCreationResult.message}
          </div>
        )}

        <form onSubmit={handleJobFormSubmit}>
          <div className="form-group">
            <label htmlFor="job_type">Job Type:</label>
            <select
              id="job_type"
              name="job_type"
              value={jobFormData.job_type}
              onChange={handleJobFormChange}
              disabled={isSubmitting}
            >
              <option value="FULL_PIPELINE">Full Pipeline (PCA + UMAP + Report)</option>
              <option value="PCA">PCA Only</option>
              <option value="UMAP">UMAP Only</option>
              <option value="REPORT">Report Only</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="priority">Priority (0-100):</label>
            <input
              type="number"
              id="priority"
              name="priority"
              min="0"
              max="100"
              value={jobFormData.priority}
              onChange={handleJobFormChange}
              disabled={isSubmitting}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="max_votes">Max Votes (optional):</label>
              <input
                type="number"
                id="max_votes"
                name="max_votes"
                min="0"
                value={jobFormData.max_votes}
                onChange={handleJobFormChange}
                disabled={isSubmitting}
                placeholder="Leave empty for all votes"
              />
            </div>

            <div className="form-group">
              <label htmlFor="batch_size">Batch Size (optional):</label>
              <input
                type="number"
                id="batch_size"
                name="batch_size"
                min="1"
                value={jobFormData.batch_size}
                onChange={handleJobFormChange}
                disabled={isSubmitting}
                placeholder="Default batch size"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="model">LLM Model:</label>
            <select
              id="model"
              name="model"
              value={jobFormData.model}
              onChange={handleJobFormChange}
              disabled={isSubmitting}
            >
              <option value="claude-opus-4-20250514">Claude Opus 4</option>
              <option value="claude-3-7-sonnet-20250219">Claude 3.7 Sonnet</option>
              <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
            </select>
          </div>

          <div className="form-group checkbox">
            <label htmlFor="include_topics">
              <input
                type="checkbox"
                id="include_topics"
                name="include_topics"
                checked={jobFormData.include_topics}
                onChange={handleJobFormChange}
                disabled={isSubmitting}
              />
              Generate topic names
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" className="submit-button" disabled={isSubmitting}>
              {isSubmitting ? "Creating Job..." : "Create Job"}
            </button>
          </div>
        </form>
      </div>
    );
  };

  // Render visualization section
  const renderVisualizations = () => {
    if (visualizationsLoading) {
      return <div className="loading">Loading visualizations...</div>;
    }

    return (
      <>
        <div className="section-header-actions">
          <button className="create-job-button" onClick={toggleJobForm}>
            {jobFormOpen ? "Cancel" : "Run New Delphi Analysis"}
          </button>
        </div>

        {jobFormOpen && renderJobCreationForm()}

        {!visualizationJobs ||
        !Array.isArray(visualizationJobs) ||
        visualizationJobs.length === 0 ? (
          <div className="info-message">
            <p>
              No visualizations available yet. Click "Run New Delphi Analysis" to create a new job.
            </p>
          </div>
        ) : (
          <div className="visualizations-container">
            {(() => {
              const bestJob = getBestVisualizationJob();
              return bestJob && (
                <div className="visualization-job">
                  <div className="job-header">
                    <h3>Interactive Topics Visualization (all comments)</h3>
                    <div className="job-meta">
                      <span className={`job-status status-${bestJob.status}`}>
                        {bestJob.status}
                      </span>
                      <span className="job-date">
                        Created: {new Date(bestJob.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {bestJob.visualizations &&
                  Array.isArray(bestJob.visualizations) &&
                  bestJob.visualizations.length > 0 ? (
                  <div className="visualizations-grid">
                    {/* Show selected layer visualization */}
                    {bestJob.visualizations
                      .filter((vis) => vis && vis.type === "interactive" && vis.layerId === selectedLayer)
                      .map((vis) => (
                        <div key={vis.key} className="visualization-card">
                          <h4>Layer {vis.layerId} Interactive Visualization</h4>
                          <div className="iframe-container">
                            <iframe
                              src={vis.url}
                              title={`Layer ${vis.layerId} visualization`}
                              width="100%"
                              height="800"
                              frameBorder="0"
                            ></iframe>
                          </div>
                        </div>
                      ))}

                    {bestJob.visualizations
                      .filter(
                        (vis) =>
                          vis &&
                          (vis.type === "static_png" || vis.type === "presentation_png") &&
                          vis.layerId === selectedLayer
                      )
                      .map((vis) => (
                        <div key={vis.key} className="visualization-card">
                          <h4>Layer {vis.layerId} Static Visualization</h4>
                          <div className="img-container">
                            <img
                              src={vis.url}
                              alt={`Layer ${vis.layerId} visualization`}
                              width="100%"
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="no-visualizations-message">
                    <p>No visualizations available for this job yet.</p>
                    <p className="help-text">
                      Visualizations may take a few minutes to generate. You can refresh the page to
                      check for updates.
                    </p>
                  </div>
                )}
                </div>
              );
            })()}
          </div>
        )}
      </>
    );
  };

  // Render narrative reports section with dropdown
  const renderNarrativeReports = () => {
    if (narrativeLoading) {
      return <div className="loading">Loading narrative reports...</div>;
    }

    const hasReports = Object.keys(narrativeReports).length > 0;

    if (!hasReports) {
      return (
        <div className="info-message">
          <p>
            No narrative reports available yet. These are generated automatically when you run a
            Delphi analysis.
          </p>
        </div>
      );
    }

    return (
      <div className="narrative-reports-container">
        {narrativeRunInfo &&
            narrativeRunInfo.available &&
            narrativeRunInfo.available.length > 0 && (
              <div className="run-info-banner">
                <p>
                  Showing reports for Job ID:{" "}
                  <strong>{narrativeRunInfo.current_job_id}</strong>
                  {(() => {
                    const currentRunDetails = narrativeRunInfo.available.find(
                      (run) => run.job_id === narrativeRunInfo.current_job_id
                    );
                    if (currentRunDetails && currentRunDetails.latest_timestamp) {
                      return ` (Generated: ${new Date(
                        currentRunDetails.latest_timestamp
                      ).toLocaleString()})`;
                    }
                    return "";
                  })()}
                  . ({narrativeRunInfo.available.length} run
                  {narrativeRunInfo.available.length !== 1 ? "s" : ""} available - showing most
                  recent)
                </p>
              </div>
            )}
        {/* Report section dropdown */}
        <div className="report-selector">
          <select 
            value={selectedReportSection} 
            onChange={handleReportSectionChange}
          >
            <option value="">Select a report section...</option>
            {availableReportSections.map(section => (
              <option key={section.key} value={section.key}>
                {section.title}
              </option>
            ))}
          </select>
        </div>

        {/* Render selected report */}
        {selectedReportSection && renderSelectedReport()}
      </div>
    );
  };

  // Render the selected report section
  const renderSelectedReport = () => {
    const report = narrativeReports[selectedReportSection];
    if (!report) return null;

    // Get the display title
    const selectedSection = availableReportSections.find(s => s.key === selectedReportSection);
    const sectionTitle = selectedSection ? selectedSection.title : selectedReportSection;

    return (
      <div key={selectedReportSection} className="report-section">
        <h3>{sectionTitle}</h3>
        <div className="report-metadata">
          <span>Generated: {new Date(report.timestamp).toLocaleString()}</span>
          <span> | Model: {report.model || "N/A"}</span>
        </div>
        <div className="report-content">
          {(() => {
            if (!report.report_data) return null;
            if (report.errors)
              return (
                <p>Not enough data has been provided for analysis, please check back later</p>
              );

            if (
              typeof report.report_data !== "string" ||
              !report.report_data.trim().startsWith("{") ||
              !report.report_data.trim().endsWith("}")
            ) {
              return (
                <article style={{ maxWidth: "600px" }}>
                  <h5>Report data is not in the expected JSON format.</h5>
                  <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                    {report.report_data}
                  </pre>
                </article>
              );
            }

            try {
              const respData = JSON.parse(report.report_data);

              const extractCitationsForThisSection = (data) => {
                const collectedCitations = [];

                if (data?.paragraphs) {
                  data.paragraphs.forEach((paragraph, pIdx) => {
                    if (paragraph?.sentences) {
                      paragraph.sentences.forEach((sentence, sIdx) => {
                        if (sentence?.clauses) {
                          sentence.clauses.forEach((clause, clIdx) => {
                            if (clause?.citations && Array.isArray(clause.citations)) {
                              clause.citations.forEach((citation, citIdx) => {
                                if (typeof citation === "number") {
                                  collectedCitations.push(citation);
                                }
                              });
                            }
                          });
                        }
                      });
                    }
                  });
                }
                return [...new Set(collectedCitations)];
              };

              const sectionCitationIds = extractCitationsForThisSection(respData);

              return (
                <div className="narrative-layout-container">
                  <article className="narrative-text-content">
                    {respData?.paragraphs?.map((pSection) => (
                      <div key={pSection.id}>
                        <h5>{pSection.title}</h5>
                        {pSection.sentences.map((sentence, idx) => (
                          <p key={idx}>
                            {sentence.clauses.map((clause, cIdx) => (
                              <span key={cIdx}>
                                {clause.text}
                                {clause.citations
                                  ?.filter((c) => typeof c === "number")
                                  .map((citation, citIdx, arr) => (
                                    <sup key={citIdx}>
                                      {citation}
                                      {citIdx < arr.length - 1 ? ", " : ""}
                                    </sup>
                                  ))}
                                {cIdx < sentence.clauses.length - 1 ? " " : ""}
                              </span>
                            ))}
                          </p>
                        ))}
                      </div>
                    ))}
                  </article>

                  {sectionCitationIds.length > 0 && (
                    <div className="narrative-comments-column">
                      <h5>Referenced Comments</h5>
                      <CommentList
                        conversation={conversation}
                        ptptCount={ptptCount}
                        math={math}
                        formatTid={formatTid}
                        tidsToRender={sectionCitationIds}
                        comments={comments}
                        voteColors={voteColors}
                      />
                    </div>
                  )}
                </div>
              );
            } catch (error) {
              console.error(
                `[${selectedReportSection}] Error processing narrative report section:`,
                error,
                "Report data was:",
                report.report_data
              );
              return (
                <article style={{ maxWidth: "600px" }}>
                  <h5>An error occurred while processing this report section.</h5>
                  <pre>{error.message}</pre>
                  <p>Problematic data for section {selectedReportSection}:</p>
                  <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                    {report.report_data}
                  </pre>
                </article>
              );
            }
          })()}
        </div>
      </div>
    );
  };

  return (
    <div className="comments-report">
      {/* Use a simple h1 instead of the Heading component */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #ccc",
          marginBottom: 20,
          paddingBottom: 10,
        }}
      >
        <h1>Comments Report</h1>
        <div>Report ID: {report_id}</div>
      </div>

      {loading ? (
        <div className="loading">Loading LLM topics data...</div>
      ) : error ? (
        <div className="error-message">
          <h3>Not Available Yet</h3>
          <p>{error}</p>
          <p>
            The Delphi system needs to process this conversation with LLM topic generation before
            this report will be available.
          </p>
          <div className="section-header-actions" style={{ marginTop: "20px" }}>
            <button className="create-job-button" onClick={toggleJobForm}>
              {jobFormOpen ? "Cancel" : "Run New Delphi Analysis"}
            </button>
          </div>

          {jobFormOpen && renderJobCreationForm()}
        </div>
      ) : (
        <div className="report-content">
          {/* Action buttons at the top */}
          <div className="section">
            <h2>Analysis Actions</h2>
            <div className="action-buttons-grid">
              <div className="action-button-group">
                <h3>Data Processing</h3>
                <div className="section-header-actions">
                  <button className="create-job-button" onClick={toggleJobForm}>
                    {jobFormOpen ? "Cancel" : "Run New Delphi Analysis"}
                  </button>
                </div>
                {jobFormOpen && renderJobCreationForm()}
              </div>
              
              <div className="action-button-group">
                <h3>Narrative Generation</h3>
                <div className="section-header-actions">
                  <button
                    className="batch-report-button"
                    onClick={handleGenerateNarrativeReport}
                    disabled={batchReportLoading}
                  >
                    {batchReportLoading ? "Generating..." : "Generate Batch Topics"}
                  </button>
                </div>
                {batchReportResult && (
                  <div className={`result-message ${batchReportResult.success ? "success" : "error"}`}>
                    {batchReportResult.message}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="section">
            <h2>Topic Visualizations</h2>
            <p className="info-text">
              These visualizations show the spatial relationships between topics and comments.
              Similar comments are positioned closer together on the map.
            </p>
            {renderLayerSwitcher()}
            {renderVisualizations()}
          </div>

          <div className="section">
            <h2>Narrative Report</h2>
            <p className="info-text">
              This narrative report provides insights about group consensus, differences, and key
              topics in the conversation.
            </p>
            {renderNarrativeReports()}
          </div>

          {/* Topics section moved to bottom */}
          <div className="section">
            <div className="run-info">
              <div className="run-header">
                <h2>
                  Group Topics{" "}
                  <span style={{ fontWeight: "normal", fontSize: "0.8em" }}>
                    generated by {selectedRun?.model_name}
                  </span>
                </h2>
                <p className="generated-date">Generated on {selectedRun?.created_date}</p>
              </div>

              <p className="info-text">
                These are LLM-generated topic names based on the comments in each group. The
                algorithm has analyzed the content of comments to extract the main themes.
              </p>

              {selectedRun?.topics_by_layer && selectedRun.topics_by_layer[selectedLayer] && (
                <div className="layer-section">
                  <h2>Group Themes - Layer {selectedLayer}</h2>
                  {renderTopicCards(selectedLayer)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .comments-report {
          padding: 20px;
          width: 90%;
          max-width: 1600px;
          margin: 0 auto;
        }

        .topics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          margin-top: 20px;
        }

        .topic-card {
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 16px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
          background: white;
        }

        .topic-card h3 {
          margin-top: 0;
          color: #03a9f4;
        }

        .topic-meta {
          font-size: 0.8rem;
          color: #666;
          margin-top: 12px;
        }

        .layer-section {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #eee;
        }

        .run-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 5px;
        }

        .generated-date {
          color: #666;
          font-size: 0.9rem;
        }

        .info-text {
          background: #f0f7ff;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 30px;
          line-height: 1.5;
          color: #444;
          border-left: 4px solid #03a9f4;
        }

        .error-message {
          background: #fef8e8;
          border: 1px solid #f2d9a0;
          border-radius: 8px;
          padding: 20px;
          margin: 20px 0;
        }

        .loading {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 200px;
          font-size: 18px;
          color: #666;
        }

        .section {
          margin-bottom: 40px;
        }

        .visualizations-container {
          margin-top: 20px;
        }

        .visualization-job {
          background: white;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
          padding: 20px;
          margin-bottom: 30px;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
        }

        .job-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .job-meta {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .job-status {
          font-size: 0.9rem;
          padding: 4px 8px;
          border-radius: 4px;
          font-weight: 500;
        }

        .status-completed {
          background: #e3f9e5;
          color: #1b873f;
        }

        .status-running {
          background: #eef3fc;
          color: #0969da;
        }

        .status-pending {
          background: #fff8c5;
          color: #9a6700;
        }

        .status-failed {
          background: #ffebe9;
          color: #cf222e;
        }

        .job-date {
          font-size: 0.9rem;
          color: #666;
        }

        .visualizations-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 5px;
        }

        .visualization-card {
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 5px;
          background: #fafafa;
        }

        .visualization-card h4 {
          margin-top: 0;
          margin-bottom: 15px;
          color: #444;
        }

        .iframe-container {
          overflow: hidden;
          border-radius: 6px;
          border: 1px solid #ddd;
          background: white;
        }

        .img-container {
          overflow: hidden;
          border-radius: 6px;
          border: 1px solid #ddd;
          background: white;
        }

        .narrative-reports-container {
          margin-top: 20px;
        }

        .run-info-banner {
          background: #e3f2fd;
          border: 1px solid #90caf9;
          border-radius: 4px;
          padding: 12px 16px;
          margin-bottom: 20px;
        }

        .run-info-banner p {
          margin: 0;
          color: #1976d2;
        }

        .run-info-note {
          color: #666;
          font-size: 0.9em;
        }

        .report-section {
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 30px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }

        .report-section h3 {
          margin-top: 0;
          color: #03a9f4;
          border-bottom: 1px solid #eee;
          padding-bottom: 10px;
          margin-bottom: 15px;
        }

        .report-metadata {
          display: flex;
          justify-content: space-between;
          font-size: 0.85rem;
          color: #666;
          margin-bottom: 20px;
        }

        .report-content {
          line-height: 1.6;
        }

        .info-message,
        .no-visualizations-message {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 8px;
          color: #666;
          font-style: italic;
        }

        .no-visualizations-message .help-text {
          font-size: 0.85rem;
          margin-top: 8px;
          color: #888;
        }

        .section-header-actions {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 20px;
        }

        .create-job-button {
          background-color: #03a9f4;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .create-job-button:hover {
          background-color: #0288d1;
        }

        .batch-report-button {
          background-color: #4caf50;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .batch-report-button:hover {
          background-color: #388e3c;
        }

        .batch-report-button:disabled {
          background-color: #a5d6a7;
          cursor: not-allowed;
        }

        .job-creation-form-container {
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 30px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
        }

        .form-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 1px solid #eee;
        }

        .form-header h3 {
          margin: 0;
          color: #333;
        }

        .close-button {
          background: none;
          border: none;
          font-size: 24px;
          color: #888;
          cursor: pointer;
        }

        .form-group {
          margin-bottom: 15px;
        }

        .form-group label {
          display: block;
          margin-bottom: 5px;
          font-weight: 500;
          color: #444;
        }

        .form-group input,
        .form-group select {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
        }

        .form-group.checkbox {
          display: flex;
          align-items: center;
        }

        .form-group.checkbox label {
          display: flex;
          align-items: center;
          cursor: pointer;
        }

        .form-group.checkbox input {
          width: auto;
          margin-right: 8px;
        }

        .form-actions {
          margin-top: 25px;
          display: flex;
          justify-content: flex-end;
        }

        .submit-button {
          background-color: #4caf50;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .submit-button:hover {
          background-color: #388e3c;
        }

        .submit-button:disabled {
          background-color: #a5d6a7;
          cursor: not-allowed;
        }

        .result-message {
          padding: 12px 16px;
          border-radius: 4px;
          margin-bottom: 20px;
          font-weight: 500;
        }

        .result-message.success {
          background-color: #e8f5e9;
          color: #2e7d32;
          border: 1px solid #a5d6a7;
        }

        .result-message.error {
          background-color: #ffebee;
          color: #c62828;
          border: 1px solid #ffcdd2;
        }

        /* New styles for narrative report layout */
        .narrative-layout-container {
          display: flex;
          flex-direction: row;
          gap: 20px; /* Adjust gap as needed */
        }

        .narrative-text-content {
          flex-grow: 0; /* Do not grow beyond basis */
          flex-shrink: 1; /* Allow shrinking if space is tight */
          flex-basis: 520px; /* Preferred width, acts as max when grow is 0 */
        }

        .narrative-comments-column {
          flex-grow: 1; /* Grow to fill available space */
          flex-shrink: 1; /* Allow shrinking */
          flex-basis: 0%; /* Start with no intrinsic width, rely on grow */
          min-width: 400px; /* Ensure CommentList doesn't get too squished */
        }

        /* Responsive stacking for smaller screens */
        @media (max-width: 992px) {
          .narrative-layout-container {
            flex-direction: column;
          }

          .narrative-text-content,
          .narrative-comments-column {
            flex-basis: auto; /* Reset flex-basis */
            width: 100%; /* Take full width when stacked */
          }

          .narrative-comments-column {
            margin-top: 30px; /* Add space when stacked below text */
          }
        }

        /* Layer switcher styles */
        .layer-switcher {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
          border: 1px solid #e9ecef;
        }

        .layer-switcher h3 {
          margin-top: 0;
          margin-bottom: 10px;
          color: #333;
        }

        .switcher-description {
          margin-bottom: 15px;
          color: #666;
          font-size: 0.9em;
        }

        .layer-buttons {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .layer-button {
          background: white;
          border: 2px solid #03a9f4;
          color: #03a9f4;
          padding: 12px 16px;
          border-radius: 6px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          flex-direction: column;
          align-items: center;
          min-width: 140px;
        }

        .layer-button:hover {
          background: #e3f2fd;
        }

        .layer-button.active {
          background: #03a9f4;
          color: white;
        }

        .layer-description {
          font-size: 0.8em;
          font-weight: normal;
          opacity: 0.8;
          margin-top: 2px;
        }

        /* Action buttons grid */
        .action-buttons-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 30px;
          margin-top: 20px;
        }

        .action-button-group {
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 20px;
        }

        .action-button-group h3 {
          margin-top: 0;
          margin-bottom: 15px;
          color: #333;
          font-size: 1.1em;
        }

        @media (max-width: 768px) {
          .action-buttons-grid {
            grid-template-columns: 1fr;
          }
          
          .layer-buttons {
            justify-content: center;
          }
          
          .layer-button {
            min-width: 120px;
          }
        }

        /* Report selector styles (matching TopicReport pattern) */
        .report-selector {
          margin-bottom: 30px;
        }
        
        .report-selector select {
          width: 100%;
          max-width: 800px;
          padding: 10px;
          font-size: 16px;
          border: 1px solid #ccc;
          border-radius: 4px;
          background-color: white;
        }
      `}</style>
    </div>
  );
};

export default CommentsReport;
