// Copyright (C) 2012-present, The Authors. This program is free software: you can redistribute it and/or  modify it under the terms of the GNU Affero General Public License, version 3, as published by the Free Software Foundation. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <http://www.gnu.org/licenses/>.

import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { Box, Heading } from 'theme-ui'

import Spinner from '../framework/spinner'

@connect((state) => state.user)
class Account extends React.Component {
  buildAccountMarkup() {
    return (
      <>
        <Box>
          <Heading
            as="h3"
            sx={{
              fontSize: [3, null, 4],
              lineHeight: 'body',
              mb: [3, null, 4]
            }}>
            Account
          </Heading>
          <p>Hi {this.props.user.hname.split(' ')[0]}!</p>
          <Box>
            <p>{this.props.user.hname}</p>
            <p>{this.props.user.email}</p>
            {this.props.user.isPaidAccount ? (
              <p><a href={process.env.SUBSCRIPTION_LINK}>Manage Subscription</a></p>
            ) : (
              <stripe-buy-button
                buy-button-id={process.env.SUBSCRIPTION_ID}
                publishable-key={process.env.SUBSCRIPTION_KEY}
                customer-email={this.props.user.email}
                client-reference-id={this.props.user.uid}
              >
              </stripe-buy-button>
            )}
          </Box>
        </Box>
      </>
    )
  }

  render() {
    return (
      <div>
        {this.props.user.hname ? this.buildAccountMarkup() : <Spinner />}
      </div>
    )
  }
}

Account.propTypes = {
  user: PropTypes.shape({
    hname: PropTypes.string,
    email: PropTypes.string,
  })
}

export default Account
