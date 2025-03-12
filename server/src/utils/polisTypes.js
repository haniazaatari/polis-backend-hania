import _ from 'underscore';

/**
 * Constants for Polis application
 */
const polisTypes = {
  reactions: {
    push: 1,
    pull: -1,
    see: 0,
    pass: 0
  },
  staractions: {
    unstar: 0,
    star: 1
  },
  mod: {
    ban: -1,
    unmoderated: 0,
    ok: 1
  }
};
polisTypes.reactionValues = _.values(polisTypes.reactions);
polisTypes.starValues = _.values(polisTypes.staractions);

export default polisTypes;
