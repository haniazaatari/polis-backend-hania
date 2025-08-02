import React, { useState, useEffect } from "react";
import net from "../../util/net";
import CommentList from "../lists/commentList.jsx";

const CollectiveStatementModal = ({
  isOpen,
  onClose,
  topicName,
  topicKey,
  reportId,
  conversation,
  math,
  comments,
  ptptCount,
  formatTid,
  voteColors,
}) => {
  const [loading, setLoading] = useState(false);
  const [statementData, setStatementData] = useState(null);
  const [commentsData, setCommentsData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen && topicKey && reportId) {
      generateStatement();
    }
  }, [isOpen, topicKey, reportId]);

  const generateStatement = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await net.polisPost("/api/v3/collectiveStatement", {
        report_id: reportId,
        topic_key: topicKey,
        topic_name: topicName,
      });

      if (response.status === "success") {
        console.log("Collective statement response:", response);
        setStatementData(response.statementData);
        setCommentsData(response.commentsData);
      } else {
        setError(response.message || "Failed to generate statement");
      }
    } catch (err) {
      console.error("Error generating collective statement:", err);
      setError(err.message || "Failed to generate collective statement");
    } finally {
      setLoading(false);
    }
  };

  // Extract citation IDs from the statement data
  const extractCitations = (content) => {
    const citations = [];
    if (content && content.paragraphs) {
      content.paragraphs.forEach((paragraph) => {
        if (paragraph.sentences) {
          paragraph.sentences.forEach((sentence) => {
            if (sentence.clauses) {
              sentence.clauses.forEach((clause) => {
                if (clause.citations && Array.isArray(clause.citations)) {
                  citations.push(...clause.citations.filter((c) => typeof c === "number"));
                }
              });
            }
          });
        }
      });
    }
    return [...new Set(citations)]; // Remove duplicates
  };

  // Clear state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStatementData(null);
      setCommentsData(null);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "8px",
          maxWidth: "1200px",
          width: "90%",
          maxHeight: "80vh",
          overflow: "auto",
          padding: "30px",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{ marginBottom: "30px", borderBottom: "2px solid #eee", paddingBottom: "20px" }}
        >
          <h2 style={{ margin: 0, marginBottom: "8px", fontSize: "1.8em" }}>{topicName}</h2>
          <p style={{ margin: 0, color: "#666", fontSize: "1.1em" }}>Candidate Collective Statement</p>
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: "40px" }}>
            <p>Generating collective statement...</p>
            <p style={{ fontSize: "0.85em", color: "#666", marginTop: "10px" }}>
              This may take a moment as we analyze voting patterns and comments.
            </p>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "20px",
              backgroundColor: "#fee",
              borderRadius: "4px",
              marginBottom: "20px",
            }}
          >
            <p style={{ margin: 0, color: "#c00" }}>Error: {error}</p>
          </div>
        )}

        {!loading && !error && statementData && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "30px",
              alignItems: "start",
            }}
          >
            {/* Left side: Collective Statement */}
            <div>
              <h3 style={{ marginTop: 0, marginBottom: "20px", fontSize: "1.2em" }}>Statement</h3>
              <div
                style={{
                  padding: "20px",
                  backgroundColor: "#f8f9fa",
                  borderRadius: "8px",
                  lineHeight: "1.6",
                  height: "100%",
                  maxHeight: "500px",
                  overflowY: "auto",
                }}
              >
                {statementData &&
                  statementData.paragraphs &&
                  statementData.paragraphs.map((paragraph, idx) => (
                    <div key={idx} style={{ marginBottom: "20px" }}>
                      <h4 style={{ marginTop: 0, marginBottom: "10px", color: "#333" }}>
                        {paragraph.title}
                      </h4>
                      {paragraph.sentences &&
                        paragraph.sentences.map((sentence, sIdx) => (
                          <p key={sIdx} style={{ marginBottom: "10px" }}>
                            {sentence.clauses &&
                              sentence.clauses.map((clause, cIdx) => (
                                <span key={cIdx}>
                                  {clause.text}
                                  {clause.citations && clause.citations.length > 0 && (
                                    <sup
                                      style={{
                                        color: "#007bff",
                                        fontSize: "0.8em",
                                        marginLeft: "2px",
                                      }}
                                    >
                                      [{clause.citations.join(", ")}]
                                    </sup>
                                  )}
                                  {cIdx < sentence.clauses.length - 1 && " "}
                                </span>
                              ))}
                          </p>
                        ))}
                    </div>
                  ))}
              </div>
            </div>

            {/* Right side: Cited Comments */}
            <div>
              <h3 style={{ marginTop: 0, marginBottom: "20px", fontSize: "1.2em" }}>
                Cited Comments
              </h3>
              {comments && comments.length > 0 && statementData ? (
                <div
                  style={{
                    backgroundColor: "#fff",
                    border: "1px solid #e0e0e0",
                    borderRadius: "8px",
                    padding: "15px",
                    maxHeight: "500px",
                    overflowY: "auto",
                  }}
                >
                  <CommentList
                    conversation={conversation}
                    ptptCount={ptptCount}
                    math={math}
                    formatTid={formatTid}
                    tidsToRender={extractCitations(statementData)}
                    comments={comments}
                    voteColors={
                      voteColors || {
                        agree: "#21a53a",
                        disagree: "#e74c3c",
                        pass: "#b3b3b3",
                      }
                    }
                  />
                </div>
              ) : (
                <div
                  style={{
                    padding: "40px",
                    textAlign: "center",
                    color: "#999",
                    backgroundColor: "#f8f9fa",
                    borderRadius: "8px",
                  }}
                >
                  No comments referenced
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && !error && statementData && (
          <div
            style={{
              marginTop: "30px",
              padding: "15px",
              backgroundColor: "#e7f3ff",
              borderRadius: "4px",
              fontSize: "0.85em",
              color: "#666",
            }}
          >
            <p style={{ margin: 0 }}>
              <strong>Note:</strong> This candidate collective statement was generated using AI (Claude Opus
              4) based on the voting patterns and comments from all participants. It represents
              areas of shared understanding and consensus on this topic.
            </p>
          </div>
        )}

        <div style={{ marginTop: "30px", textAlign: "right" }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px",
              backgroundColor: "#007bff",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "1em",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default CollectiveStatementModal;
