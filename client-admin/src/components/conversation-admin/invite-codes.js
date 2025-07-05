// Copyright (C) 2012-present, The Authors. This program is free software: you can redistribute it and/or  modify it under the terms of the GNU Affero General Public License, version 3, as published by the Free Software Foundation. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <http://www.gnu.org/licenses/>.

/** @jsx jsx */

import React from 'react'
import { connect } from 'react-redux'
import { Heading, Box, Text, Button, jsx } from 'theme-ui'
import PolisNet from '../../util/net'
import ComponentHelpers from '../../util/component-helpers'
import NoPermission from './no-permission'

@connect((state) => state.user)
@connect((state) => state.zid_metadata)
class InviteCodes extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      loading: false,
      rootCodes: [],
      generatingCode: false,
      error: null
    }
  }

  componentDidMount() {
    this.loadInviteCodes()
  }

  loadInviteCodes = () => {
    const { conversation_id } = this.props.match.params
    
    this.setState({ loading: true })
    
    PolisNet.polisGet('/api/v3/conversations/' + conversation_id + '/invite-tree')
      .then((res) => {
        // Filter to only show root codes (wave 0) and limit to 5
        const rootCodes = (res.invite_tree || [])
          .filter(code => code.wave_number === 0)
          .slice(0, 5)
        
        this.setState({
          rootCodes,
          loading: false,
          error: null
        })
      })
      .fail((err) => {
        this.setState({
          loading: false,
          error: err.responseText || 'Failed to load invite codes'
        })
      })
  }

  generateRootCode = () => {
    const { conversation_id } = this.props.match.params
    
    this.setState({ generatingCode: true })
    
    PolisNet.polisPost('/api/v3/conversations/' + conversation_id + '/invite-codes', {})
      .then((res) => {
        this.setState({ generatingCode: false })
        // Reload codes to show the new one
        this.loadInviteCodes()
      })
      .fail((err) => {
        this.setState({
          generatingCode: false,
          error: err.responseText || 'Failed to generate invite code'
        })
      })
  }

  copyToClipboard = (code) => {
    const url = `${window.location.origin}/invite/${code}`
    navigator.clipboard.writeText(url).then(() => {
      // Could add a toast notification here
      alert('Copied to clipboard!')
    })
  }

  render() {
    if (ComponentHelpers.shouldShowPermissionsError(this.props)) {
      return <NoPermission />
    }

    const { rootCodes, loading, generatingCode, error } = this.state
    const hasRootCodes = rootCodes.length > 0
    const canGenerateMore = rootCodes.length < 5

    return (
      <Box>
        <Heading
          as="h3"
          sx={{
            fontSize: [3, null, 4],
            lineHeight: 'body',
            mb: [3, null, 4]
          }}>
          Invite Codes
        </Heading>

        <Box sx={{ mb: [4] }}>
          <Text sx={{ color: 'gray', fontSize: [1, null, 2] }}>
            Generate invite codes to allow controlled access to your conversation. 
            Each code can be used once to join the conversation.
          </Text>
        </Box>

        {error && (
          <Box sx={{ mb: [3], p: [2], bg: 'red.0', borderRadius: 2 }}>
            <Text sx={{ color: 'red.7' }}>{error}</Text>
          </Box>
        )}

        {loading ? (
          <Text>Loading invite codes...</Text>
        ) : (
          <>
            {!hasRootCodes ? (
              <Box sx={{ mb: [4] }}>
                <Text sx={{ mb: [3] }}>
                  No invite codes yet. Generate your first codes to get started.
                </Text>
                <Button
                  onClick={this.generateRootCode}
                  disabled={generatingCode}
                  sx={{ cursor: generatingCode ? 'wait' : 'pointer' }}>
                  {generatingCode ? 'Generating...' : 'Generate First Invite Code'}
                </Button>
              </Box>
            ) : (
              <Box>
                <Box sx={{ mb: [3] }}>
                  <Text sx={{ fontWeight: 'bold', mb: [2] }}>
                    Your Root Invite Codes ({rootCodes.length}/5)
                  </Text>
                </Box>

                {rootCodes.map((code) => (
                  <Box
                    key={code.code}
                    sx={{
                      mb: [3],
                      p: [3],
                      border: '1px solid',
                      borderColor: 'gray.2',
                      borderRadius: 2,
                      bg: code.is_used ? 'gray.0' : 'white'
                    }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box>
                        <Text
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: [2],
                            color: code.is_used ? 'gray.5' : 'black'
                          }}>
                          {code.code}
                        </Text>
                        <Text sx={{ fontSize: [1], color: 'gray.5', mt: [1] }}>
                          {code.is_used ? (
                            <>Used • {code.children_generated} child codes generated</>
                          ) : (
                            'Available'
                          )}
                        </Text>
                      </Box>
                      
                      {!code.is_used && (
                        <Button
                          onClick={() => this.copyToClipboard(code.code)}
                          sx={{ 
                            fontSize: [1],
                            py: [1],
                            px: [2]
                          }}>
                          Copy Link
                        </Button>
                      )}
                    </Box>
                  </Box>
                ))}

                {canGenerateMore && (
                  <Box sx={{ mt: [4] }}>
                    <Button
                      onClick={this.generateRootCode}
                      disabled={generatingCode}
                      sx={{ 
                        cursor: generatingCode ? 'wait' : 'pointer',
                        bg: 'gray.7',
                        '&:hover': { bg: 'gray.8' }
                      }}>
                      {generatingCode ? 'Generating...' : 'Generate Another Code'}
                    </Button>
                  </Box>
                )}
              </Box>
            )}
          </>
        )}

        <Box sx={{ mt: [5], p: [3], bg: 'blue.0', borderRadius: 2 }}>
          <Heading as="h4" sx={{ fontSize: [2], mb: [2] }}>
            How Invite Codes Work
          </Heading>
          <Text sx={{ fontSize: [1], color: 'blue.8' }}>
            1. Generate up to 5 root invite codes
          </Text>
          <Text sx={{ fontSize: [1], color: 'blue.8' }}>
            2. Share codes with trusted individuals
          </Text>
          <Text sx={{ fontSize: [1], color: 'blue.8' }}>
            3. When someone uses a code, they join the conversation
          </Text>
          <Text sx={{ fontSize: [1], color: 'blue.8', mt: [2] }}>
            Coming soon: Multi-generational invites where participants can invite others
          </Text>
        </Box>
      </Box>
    )
  }
}

export default InviteCodes