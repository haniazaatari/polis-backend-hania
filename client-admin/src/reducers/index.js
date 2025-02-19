// Copyright (C) 2012-present, The Authors. This program is free software: you can redistribute it and/or  modify it under the terms of the GNU Affero General Public License, version 3, as published by the Free Software Foundation. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { combineReducers } from 'redux'
import conversations from './conversations'
import user from './user'
import zid_metadata from './zid_metadata'
import mod_comments_accepted from './mod_comments_accepted'
import mod_comments_rejected from './mod_comments_rejected'
import mod_comments_unmoderated from './mod_comments_unmoderated'
import stats from './stats'
import seed_comments from './seed_comments'
import signout from './signout'
import signin from './signin'
import comments from './comments'

const rootReducer = combineReducers({
  conversations,
  user,
  zid_metadata,
  comments,
  mod_comments_accepted,
  mod_comments_rejected,
  mod_comments_unmoderated,
  seed_comments,
  stats,
  signout,
  signin
})

export default rootReducer
