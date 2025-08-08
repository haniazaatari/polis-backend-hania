import React, { useState } from 'react';
import { Statement } from './Statement';
import EmailSubscribeForm from './EmailSubscribeForm';
import { getPreferredLanguages } from '../strings/strings';
import { getConversationToken } from '../lib/auth';

const submitVoteAndGetNextCommentAPI = async (vote, conversation_id, high_priority = false) => {
  const decodedToken = getConversationToken(conversation_id);
  const response = await fetch(`${import.meta.env.PUBLIC_SERVICE_URL}/votes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      agid: 1,
      conversation_id,
      high_priority,
      lang: getPreferredLanguages()[0],
      pid: decodedToken?.pid || "mypid",
      tid: vote.tid,
      vote: vote.vote,
    }),
    credentials: 'include',
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(errorText || 'Vote failed');
    error.status = response.status;
    throw error;
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

  return resp;
};


export default function Survey({ initialStatement, s, conversation_id }) {
  const [statement, setStatement] = useState(initialStatement);
  const [isFetchingNext, setIsFetchingNext] = useState(false);
  const [isStatementImportant, setIsStatmentImportant] = useState(false);
  const [voteError, setVoteError] = useState(null);

  const handleVote = async (voteType, tid) => {
    setIsFetchingNext(true);
    setVoteError(null);
    
    try {
      const vote = { vote: voteType, tid: tid };
      const result = await submitVoteAndGetNextCommentAPI(vote, conversation_id, isStatementImportant);

      setVoteError(null);
      if (result?.nextComment) {
        setStatement(result.nextComment);
      } else {
        setStatement(undefined);
      }
      setIsStatmentImportant(false);

    } catch (error) {
      console.error("Vote submission failed:", error.message);
      let errorMessage = s.commentSendFailed || "Apologies, your vote failed to send. Please check your connection and try again.";

      if (error.message === "polis_err_conversation_is_closed") {
        errorMessage = s.convIsClosed || "This conversation is closed. No further voting is allowed.";
      } else if (error.message === "polis_err_post_votes_social_needed") {
        errorMessage = "You need to sign in to vote.";
      } else if (error.message === "polis_err_xid_not_whitelisted") {
        errorMessage = "Sorry, you must be registered to vote. Please sign in or contact the conversation owner.";
      }
      
      setVoteError(errorMessage);
    } finally {
      setIsFetchingNext(false);
    }
  };


  return (
    <>
      {statement ? (
        <Statement
          statement={statement}
          onVote={handleVote}
          isVoting={isFetchingNext}
          s={s}
          isStatementImportant={isStatementImportant}
          setIsStatmentImportant={setIsStatmentImportant}
          voteError={voteError}
        />
      ) : (
        <EmailSubscribeForm s={s} conversation_id={conversation_id} />
      )}
    </>
  );
}
