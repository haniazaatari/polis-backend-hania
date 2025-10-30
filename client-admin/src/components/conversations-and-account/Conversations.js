// Copyright (C) 2012-present, The Authors. This program is free software: you can redistribute it and/or  modify it under the terms of the GNU Affero General Public License, version 3, as published by the Free Software Foundation. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { useState, useEffect, useCallback } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { handleCreateConversationSubmit, populateConversationsStore } from '../../actions'
import { isAuthReady } from '../../util/net'

import Url from '../../util/url'
import { useAuth } from 'react-oidc-context'
import { Box, Heading, Button, Text, Link, Image, Close } from 'theme-ui'
import Conversation from './Conversation'
import { useLocation, useNavigate } from 'react-router'

const Conversations = () => {
  const dispatch = useDispatch()
  const location = useLocation()
  const navigate = useNavigate()
  const { isAuthenticated, isLoading } = useAuth()
  const { conversations, loading, error } = useSelector((state) => state.conversations)
  const [interstitialVisible, setInterstitialVisible] = useState(false)

  const [filterState] = useState({
    filterMinParticipantCount: 0,
    sort: 'participant_count'
  })

  const loadConversationsIfNeeded = useCallback(() => {
    const authSystemReady = isAuthReady()

    if (!isLoading && isAuthenticated && authSystemReady && !loading && !conversations) {
      dispatch(populateConversationsStore())
    }
  }, [isLoading, isAuthenticated, loading, conversations, dispatch])

  useEffect(() => {
    // Listen for auth ready event
    const handleAuthReady = () => {
      loadConversationsIfNeeded()
    }

    window.addEventListener('polisAuthReady', handleAuthReady)

    if (isAuthenticated && !isLoading) {
      loadConversationsIfNeeded()

      return () => {
        window.removeEventListener('polisAuthReady', handleAuthReady)
      }
    }

    return () => {
      window.removeEventListener('polisAuthReady', handleAuthReady)
    }
  }, [loadConversationsIfNeeded, isAuthenticated, isLoading])

  const onNewClicked = () => {
    dispatch(handleCreateConversationSubmit(navigate))
  }

  const goToConversation = (conversation_id) => {
    return () => {
      if (location.pathname === 'other-conversations') {
        window.open(`${Url.urlPrefix}${conversation_id}`, '_blank')
        return
      }
      navigate(`/m/${conversation_id}`)
    }
  }

  const filterCheck = (c) => {
    let include = true

    if (c.participant_count < filterState.filterMinParticipantCount) {
      include = false
    }

    if (location.pathname === 'other-conversations') {
      // filter out conversations i do own
      include = !c.is_owner
    }

    if (location.pathname !== 'other-conversations' && !c.is_owner) {
      // if it's not other convos and i'm not the owner, don't show it
      // filter out convos i don't own
      include = false
    }

    return include
  }

  const err = error

  return (
    <Box>
      <Heading
        as="h3"
        sx={{
          fontSize: [3, null, 4],
          lineHeight: 'body',
          mb: [3, null, 4]
        }}>
        All Conversations
      </Heading>
      {interstitialVisible && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            bg: 'rgba(0, 0, 0, 0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
          <Box
            sx={{
              bg: 'background',
              p: 4,
              borderRadius: '8px',
              boxShadow: '0 0 20px rgba(0,0,0,0.3)',
              width: ['90%', '70%', '60%'],
              maxWidth: '800px',
              maxHeight: '90vh',
              overflowY: 'auto',
              position: 'relative'
            }}>
            <Close
              onClick={() => {
                onNewClicked()
                setInterstitialVisible(false)
              }}
              sx={{
                position: 'absolute',
                top: '15px',
                right: '15px',
                cursor: 'pointer',
                color: 'textSecondary'
              }}
            />
            <Heading as="h2" sx={{ mb: 3, fontSize: 5, color: 'primary' }}>
              Introducing Delphi: AI-Powered Insights
            </Heading>
            <Text sx={{ mb: 4, fontSize: 2 }}>
              Unlock deeper understanding from your conversations with Delphi, our advanced
              analytics and AI reporting suite.
            </Text>

            <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', '1fr 1fr'], gap: 4, mb: 4 }}>
              <Box>
                <Heading as="h4" sx={{ mb: 2 }}>
                  Advanced Statistical Analysis
                </Heading>
                <Image
                  src="https://via.placeholder.com/400x250.png?text=Interactive+Topic+Map"
                  sx={{ width: '100%', borderRadius: '4px', mb: 2 }}
                />
                <Text>
                  Go beyond opinion groups with interactive topic maps and advanced data
                  visualizations. See how ideas connect and identify key areas of contention and
                  consensus.
                </Text>
              </Box>
              <Box>
                <Heading as="h4" sx={{ mb: 2 }}>
                  AI-Generated Reports
                </Heading>
                <Image
                  src="https://via.placeholder.com/400x250.png?text=AI+Narrative+Summary"
                  sx={{ width: '100%', borderRadius: '4px', mb: 2 }}
                />
                <Text>
                  Let Delphi do the heavy lifting. Get AI-generated summaries, consensus statements,
                  and detailed reports on conversation dynamics and key topics.
                </Text>
              </Box>
            </Box>

            <Box sx={{ bg: 'muted', p: 3, borderRadius: '4px', mb: 4 }}>
              <Heading as="h4" sx={{ mb: 2 }}>
                Key Delphi Features:
              </Heading>
              <ul sx={{ pl: 3, m: 0 }}>
                <li>Conversation Summaries</li>
                <li>Automated Topic Reporting</li>
                <li>Identification of Consensus Statements</li>
                <li>Divisive Comment Analysis</li>
              </ul>
            </Box>

            <Text sx={{ mb: 4, textAlign: 'center', fontSize: 2 }}>
              Ready to supercharge your analysis?
              <br />
              <Link
                href="https://pro.pol.is/"
                target="_blank"
                rel="noopener noreferrer"
                sx={{ fontWeight: 'bold' }}>
                Upgrade to a Pro plan to access Delphi.
              </Link>
            </Text>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 3 }}>
              <Button
                variant="secondary"
                onClick={() => {
                  onNewClicked()
                  setInterstitialVisible(false)
                }}
                sx={{
                  cursor: 'pointer'
                }}>
                Maybe Later
              </Button>
              <Button
                onClick={() => {
                  onNewClicked()
                  setInterstitialVisible(false)
                }}
                sx={{
                  cursor: 'pointer',
                  bg: 'primary',
                  '&:hover': {
                    bg: 'text'
                  }
                }}>
                Create Conversation
              </Button>
            </Box>
          </Box>
        </Box>
      )}
      <Box sx={{ mb: [3, null, 4] }}>
        <Button onClick={() => setInterstitialVisible(true)}>Create new conversation</Button>
      </Box>
      <Box>
        <Box sx={{ mb: [3] }}>{loading ? 'Loading conversations...' : null}</Box>
        {err ? (
          <Text>{'Error loading conversations: ' + err.status + ' ' + err.statusText}</Text>
        ) : null}
        {conversations
          ? conversations.map((c, i) => {
              return filterCheck(c) ? (
                <Conversation
                  key={c.conversation_id}
                  c={c}
                  i={i}
                  goToConversation={goToConversation(c.conversation_id)}
                />
              ) : null
            })
          : null}
      </Box>
    </Box>
  )
}

export default Conversations
