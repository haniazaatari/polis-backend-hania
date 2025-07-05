import React, { useState, useEffect } from "react";
import net from "../../util/net.js";

const InviteCodes = ({ conversation }) => {
  const [inviteCodes, setInviteCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    if (conversation && conversation.conversation_id) {
      loadInviteCodes();
    }
  }, [conversation]);

  const loadInviteCodes = async () => {
    try {
      const response = await net.polisGet("/api/v3/my-invite-codes/" + conversation.conversation_id);
      
      if (response && response.codes) {
        // Limit to 3 codes for exclusivity
        setInviteCodes(response.codes.slice(0, 3));
      }
      setLoading(false);
    } catch (error) {
      console.error("Error loading invite codes:", error);
      setLoading(false);
    }
  };

  const copyToClipboard = (code) => {
    const url = `${window.location.origin}/invite/${code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  };

  // Don't render if no codes available
  if (!loading && inviteCodes.length === 0) {
    return null;
  }

  const containerStyle = {
    marginTop: 40,
    marginBottom: 40,
    padding: "25px 30px",
    backgroundColor: "#f8f9fa",
    borderRadius: 8,
    border: "1px solid #e1e4e8"
  };

  const headingStyle = {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 10,
    color: "#1a1a1a"
  };

  const subtitleStyle = {
    fontSize: 14,
    color: "#586069",
    marginBottom: 20,
    lineHeight: 1.5
  };

  const codesContainerStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 12
  };

  const codeItemStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    backgroundColor: "white",
    borderRadius: 6,
    border: "1px solid #d1d5da",
    transition: "all 0.2s ease"
  };

  const codeTextStyle = {
    fontFamily: "monospace",
    fontSize: 14,
    color: "#0366d6",
    letterSpacing: "0.05em"
  };

  const buttonStyle = {
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 500,
    color: "#24292e",
    backgroundColor: "#fafbfc",
    border: "1px solid #d1d5da",
    borderRadius: 4,
    cursor: "pointer",
    transition: "all 0.2s ease",
    outline: "none"
  };

  const buttonHoverStyle = {
    ...buttonStyle,
    backgroundColor: "#f3f4f6"
  };

  const copiedStyle = {
    ...buttonStyle,
    color: "#28a745",
    backgroundColor: "#d4edda",
    border: "1px solid #c3e6cb"
  };

  return (
    <div style={containerStyle}>
      <h3 style={headingStyle}>My Invite Codes</h3>
      <p style={subtitleStyle}>
        Share these exclusive invite codes with people you'd like to join the conversation. 
        Each code can be used once.
      </p>

      {loading ? (
        <div style={{ color: "#586069" }}>Loading invite codes...</div>
      ) : (
        <div style={codesContainerStyle}>
          {inviteCodes.map((code) => (
            <div key={code} style={codeItemStyle}>
              <span style={codeTextStyle}>{code}</span>
              <button
                style={copied === code ? copiedStyle : buttonStyle}
                onMouseEnter={(e) => {
                  if (copied !== code) {
                    Object.assign(e.target.style, buttonHoverStyle);
                  }
                }}
                onMouseLeave={(e) => {
                  if (copied !== code) {
                    Object.assign(e.target.style, buttonStyle);
                  }
                }}
                onClick={() => copyToClipboard(code)}
              >
                {copied === code ? "Copied!" : "Copy Link"}
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && inviteCodes.length === 3 && (
        <p style={{ ...subtitleStyle, marginTop: 16, fontSize: 12, fontStyle: "italic" }}>
          Limited to 3 invite codes to maintain exclusivity. 
          More codes may become available as the conversation grows.
        </p>
      )}
    </div>
  );
};

export default InviteCodes;