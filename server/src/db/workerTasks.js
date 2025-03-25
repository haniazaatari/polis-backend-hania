import { queryP } from './pg-query.js';

/**
 * Get worker tasks by type and bucket
 * @param {string} taskType - Task type
 * @param {number} taskBucket - Task bucket
 * @returns {Promise<Array>} - Worker tasks
 */
async function getWorkerTasksByTypeAndBucket(taskType, taskBucket) {
  return await queryP('select * from worker_tasks where task_type = $1 and task_bucket = $2;', [taskType, taskBucket]);
}

export { getWorkerTasksByTypeAndBucket };
