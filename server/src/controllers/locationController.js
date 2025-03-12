import _ from 'underscore';
import { getLocationsForParticipants } from '../services/location/locationService.js';
import { getPidsForGid } from '../utils/participants.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET /locations
 * Get locations for participants in a conversation, filtered by group
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function handleGetLocations(req, res) {
  try {
    const zid = req.p.zid;
    const gid = req.p.gid;

    const [pids, locations] = await Promise.all([getPidsForGid(zid, gid, -1), getLocationsForParticipants(zid)]);

    // Filter locations to only include participants in the specified group
    let filteredLocations = locations.filter((locData) => {
      const pidIsInGroup = _.indexOf(pids, locData.pid, true) >= 0;
      return pidIsInGroup;
    });

    // Map locations to the expected format
    filteredLocations = filteredLocations.map((locData) => ({
      lat: locData.lat,
      lng: locData.lng,
      n: 1
    }));

    res.status(200).json(filteredLocations);
  } catch (err) {
    fail(res, 500, 'polis_err_locations_01', err);
  }
}
