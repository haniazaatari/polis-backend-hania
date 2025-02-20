// Copyright (C) 2012-present, The Authors. This program is free software: you can redistribute it and/or  modify it under the terms of the GNU Affero General Public License, version 3, as published by the Free Software Foundation. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Determine where to send API requests.
//
// If client-report is running on localhost:5010, it is running via webpack-dev-server,
// and should send requests to localhost:5000. (Dev API server)
//
// If client-report is running on localhost:5000, it is being served by the dev api server,
// and should send requests to localhost:5000. (Dev API server)
//
// If client-report is running on localhost:80, it is being served by the dev api server,
// via nginx-proxy, and should send requests to localhost:80. (Dev API server via nginx-proxy).
//
// If client-report is running on any polis production hostname,
// it should send requests to that hostname.
//
// Otherwise defaults to the current origin (e.g. "https://mypolis.xyz/").

const getDomainPrefix = () => {
  if (process.env.NODE_ENV === 'development') {
    return `http://${process.env.API_DEV_HOSTNAME}/`;
  }
  return `${document.location.protocol}//${document.location.host}/`;
}

const urlPrefix = getDomainPrefix();
console.log('urlPrefix', urlPrefix);

export default { urlPrefix };
