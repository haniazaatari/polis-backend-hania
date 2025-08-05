import React, { useState } from 'react';
import { getConversationToken } from '../lib/auth';

const submitPerspectiveAPI = async (text, conversation_id) => {
  const decodedToken = getConversationToken(conversation_id);
  const pid = decodedToken?.pid;

  try {
    const response = await fetch(`${import.meta.env.PUBLIC_SERVICE_URL}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        txt: text.replace(/\n/g, " "),
        conversation_id,
        pid,
        vote: -1,
      }),
      credentials: 'include',
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Comment submission failed with status ${response.status}:`, errorText);
    }

    const resp = await response.json();

    if (resp?.auth?.token) {
      // Store the token for later use
      try {
        const token = resp.auth.token;
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          if (payload.conversation_id) {
            const tokenKey = "participant_token_" + payload.conversation_id;
              if (window.localStorage) {
              window.localStorage.setItem(tokenKey, token);
            } else if (window.sessionStorage) {
              window.sessionStorage.setItem(tokenKey, token);
            }
          } else {
            console.warn("[Index] No conversation_id in JWT payload, not storing token.");
          }
        }
      } catch (e) {
        console.error("[Index] Failed to store JWT token:", e);
      }
    }
  } catch (error) {
    console.error("Network error during comment submission:", error);
  }
};


export default function SurveyForm({ s, conversation_id }) {
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState('');
  const maxLength = 400;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!text.trim()) return;
    setFeedback(s.commentSent);
    const submittedText = text;
    setText('');
    submitPerspectiveAPI(submittedText, conversation_id);
  };

  if (feedback) {
    return <p style={{ textAlign: 'center', color: '#28a745', fontWeight: 'bold' }}>{feedback}</p>;
  }

  return (
    <div>
      <div className="guidelines">
        <p dangerouslySetInnerHTML={{ __html: s.writeCommentHelpText }}/>
        <h2>{s.helpWriteListIntro}</h2>
        <ul>
          <li>{s.helpWriteListStandalone}</li>
          <li>{s.helpWriteListRaisNew}</li>
          <li>{s.helpWriteListShort}</li>
        </ul>
        <p dangerouslySetInnerHTML={{ __html: s.tipCommentsRandom }}></p>
      </div>
      <form className="submit-form" onSubmit={handleSubmit}>
        <div className="textarea-wrapper">
          <textarea
            placeholder={s.writePrompt}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={maxLength}
          />
          <div className="char-counter">
            {text.length} / {maxLength}
          </div>
        </div>
        <button type="submit" className="submit-button" disabled={!text.trim()}>
          {s.submitComment}
        </button>
      </form>
    </div>
  );
}
