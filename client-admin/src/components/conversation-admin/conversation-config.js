// Copyright (C) 2012-present, The Authors. This program is free software: you can redistribute it and/or  modify it under the terms of the GNU Affero General Public License, version 3, as published by the Free Software Foundation. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <http://www.gnu.org/licenses/>.

/** @jsx jsx */

import React from 'react'
import { connect } from 'react-redux'
import {
  handleZidMetadataUpdate,
  optimisticZidMetadataUpdateOnTyping
} from '../../actions'
import ComponentHelpers from '../../util/component-helpers'
import NoPermission from './no-permission'
import { Heading, Box, Text, jsx } from 'theme-ui'
import emoji from 'react-easy-emoji'

import { CheckboxField } from './CheckboxField'
import ModerateCommentsSeed from './seed-comment'

@connect((state) => state.user)
@connect((state) => state.zid_metadata)
class ConversationConfig extends React.Component {
  handleStringValueChange(field) {
    return () => {
      let val = this[field].value
      this.props.dispatch(
        handleZidMetadataUpdate(this.props.zid_metadata, field, val)
      )
    }
  }

  handleConfigInputTyping(field) {
    return (e) => {
      this.props.dispatch(
        optimisticZidMetadataUpdateOnTyping(
          this.props.zid_metadata,
          field,
          e.target.value
        )
      )
    }
  }

  maybeErrorMessage() {
    let markup = ''
    if (this.props.error) {
      // TODO: Use strings() helper if available and appropriate for localization
      markup = <Text sx={{ color: 'red', mt: 3 }}>{this.props.error.responseText || 'An unknown error occurred'}</Text>
    }
    return markup
  }

  render() {
    if (ComponentHelpers.shouldShowPermissionsError(this.props)) {
      return <NoPermission />
    }

    return (
      <Box>
        <Heading
          as="h3"
          sx={{
            fontSize: [3, null, 4],
            lineHeight: 'body',
            mb: [3, null, 4]
          }}>
          Configure
        </Heading>
        <Box sx={{ mb: [4] }}>
          {this.props.loading ? (
            <Text>{emoji('💾')} Saving</Text>
          ) : (
            <Text>{emoji('⚡')} Up to date</Text>
          )}
          {this.props.error ? <Text>Error Saving</Text> : null}
        </Box>

        <CheckboxField field="is_active" label="Conversation Is Open">
          Conversation is open. Unchecking disables both voting and commenting.
        </CheckboxField>

        <Box sx={{ mb: [3] }}>
          <Text sx={{ display: 'block', mb: [2] }}>Topic</Text>
          <input
            ref={(c) => (this.topic = c)}
            sx={{
              display: 'block',
              fontFamily: 'body',
              fontSize: [2],
              width: '35em',
              borderRadius: 2,
              padding: [2],
              border: '1px solid',
              borderColor: 'mediumGray'
            }}
            data-test-id="topic"
            onBlur={this.handleStringValueChange('topic').bind(this)}
            onChange={this.handleConfigInputTyping('topic').bind(this)}
            defaultValue={this.props.zid_metadata.topic}
          />
        </Box>

        <Box sx={{ mb: [3] }}>
          <Text sx={{ display: 'block', mb: [2] }}>Description</Text>
          <textarea
            ref={(c) => (this.description = c)}
            sx={{
              display: 'block',
              fontFamily: 'body',
              fontSize: [2],
              width: '35em',
              height: '7em',
              resize: 'none',
              padding: [2],
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'mediumGray'
            }}
            data-test-id="description"
            onBlur={this.handleStringValueChange('description').bind(this)}
            onChange={this.handleConfigInputTyping('description').bind(this)}
            defaultValue={this.props.zid_metadata.description}
          />
        </Box>

        <Heading
          as="h6"
          sx={{
            fontSize: [1, null, 2],
            lineHeight: 'body',
            my: [3, null, 4]
          }}>
          Seed Comments
        </Heading>
        <ModerateCommentsSeed
          params={{ conversation_id: this.props.zid_metadata.conversation_id }}
        />

        <Heading
          as="h6"
          sx={{
            fontSize: [1, null, 2],
            lineHeight: 'body',
            my: [3, null, 4]
          }}>
          Customize the user interface
        </Heading>

        <CheckboxField field="importance_enabled" label="Importance Enabled">
          [EXPERIMENTAL FEATURE] Participants can see the &quot;This comment is important&quot; checkbox
        </CheckboxField>

        <CheckboxField field="vis_type" label="Visualization" isIntegerBool>
          Participants can see the visualization
        </CheckboxField>

        <CheckboxField field="write_type" label="Comment form" isIntegerBool>
          Participants can submit comments
        </CheckboxField>

        <CheckboxField field="help_type" label="Help text" isIntegerBool>
          Show explanation text above voting and visualization
        </CheckboxField>

        <CheckboxField
          field="subscribe_type"
          label="Prompt participants to subscribe to updates"
          isIntegerBool>
          Prompt participants to subscribe to updates. A prompt is shown to
          users once they finish voting on all available comments. If enabled,
          participants may optionally provide their email address to receive
          notifications when there are new comments to vote on.
        </CheckboxField>

        <Heading
          as="h6"
          sx={{
            fontSize: [1, null, 2],
            lineHeight: 'body',
            my: [3, null, 4]
          }}>
          Schemes
        </Heading>

        <CheckboxField field="strict_moderation">
          No comments shown without moderator approval
        </CheckboxField>

        <Heading
          as="h6"
          sx={{
            fontSize: [1, null, 2],
            lineHeight: 'body',
            my: [3, null, 4]
          }}>
          Theme
        </Heading>
        <Text sx={{ fontStyle: 'italic', color: 'gray', fontSize: 1, mb: 3 }}>
          leave blank to use defaults
        </Text>

        <Box sx={{ mb: [3] }}>
          <Text sx={{ display: 'block', mb: [2] }}>Background Color</Text>
          <input
            ref={(c) => (this.bgcolor = c)}
            sx={{
              display: 'block',
              fontFamily: 'body',
              fontSize: [2],
              width: '35em',
              borderRadius: 2,
              padding: [2],
              border: '1px solid',
              borderColor: 'mediumGray'
            }}
            data-test-id="bgcolor"
            onBlur={this.handleStringValueChange('bgcolor').bind(this)}
            onChange={this.handleConfigInputTyping('bgcolor').bind(this)}
            defaultValue={this.props.zid_metadata.bgcolor || 'white'}
          />
        </Box>

        <Box sx={{ mb: [3] }}>
          <Text sx={{ display: 'block', mb: [2] }}>Button Color</Text>
          <input
            ref={(c) => (this.style_btn = c)}
            sx={{
              display: 'block',
              fontFamily: 'body',
              fontSize: [2],
              width: '35em',
              borderRadius: 2,
              padding: [2],
              border: '1px solid',
              borderColor: 'mediumGray'
            }}
            data-test-id="style_btn"
            onBlur={this.handleStringValueChange('style_btn').bind(this)}
            onChange={this.handleConfigInputTyping('style_btn').bind(this)}
            defaultValue={this.props.zid_metadata.style_btn || '#0090ff'}
          />
        </Box>

        <Box sx={{ mb: [3] }}>
          <Text sx={{ display: 'block', mb: [2] }}>Font Color</Text>
          <input
            ref={(c) => (this.font_color = c)}
            sx={{
              display: 'block',
              fontFamily: 'body',
              fontSize: [2],
              width: '35em',
              borderRadius: 2,
              padding: [2],
              border: '1px solid',
              borderColor: 'mediumGray'
            }}
            data-test-id="font_color"
            onBlur={this.handleStringValueChange('font_color').bind(this)}
            onChange={this.handleConfigInputTyping('font_color').bind(this)}
            defaultValue={this.props.zid_metadata.font_color || 'rgb(0, 0, 0)'}
          />
        </Box>

        <Box sx={{ mb: [3] }}>
          <Text sx={{ display: 'block', mb: [2] }}>Title Font</Text>
          <input
            ref={(c) => (this.font_title = c)}
            sx={{
              display: 'block',
              fontFamily: 'body',
              fontSize: [2],
              width: '35em',
              borderRadius: 2,
              padding: [2],
              border: '1px solid',
              borderColor: 'mediumGray'
            }}
            data-test-id="font_title"
            onBlur={this.handleStringValueChange('font_title').bind(this)}
            onChange={this.handleConfigInputTyping('font_title').bind(this)}
            defaultValue={this.props.zid_metadata.font_title || 'Helvetica Neue'}
          />
        </Box>

        <Box sx={{ mb: [3] }}>
          <Text sx={{ display: 'block', mb: [2] }}>Sans Font</Text>
          <input
            ref={(c) => (this.font_sans = c)}
            sx={{
              display: 'block',
              fontFamily: 'body',
              fontSize: [2],
              width: '35em',
              borderRadius: 2,
              padding: [2],
              border: '1px solid',
              borderColor: 'mediumGray'
            }}
            data-test-id="font_sans"
            onBlur={this.handleStringValueChange('font_sans').bind(this)}
            onChange={this.handleConfigInputTyping('font_sans').bind(this)}
            defaultValue={this.props.zid_metadata.font_sans || 'Helvetica Neue'}
          />
        </Box>

        <Box sx={{ mb: [3] }}>
          <Text sx={{ display: 'block', mb: [2] }}>Serif Font</Text>
          <input
            ref={(c) => (this.font_serif = c)}
            sx={{
              display: 'block',
              fontFamily: 'body',
              fontSize: [2],
              width: '35em',
              borderRadius: 2,
              padding: [2],
              border: '1px solid',
              borderColor: 'mediumGray'
            }}
            data-test-id="font_serif"
            onBlur={this.handleStringValueChange('font_serif').bind(this)}
            onChange={this.handleConfigInputTyping('font_serif').bind(this)}
            defaultValue={this.props.zid_metadata.font_serif || 'chaparral-pro'}
          />
        </Box>

        {this.maybeErrorMessage()}
      </Box>
    )
  }
}

export default ConversationConfig
