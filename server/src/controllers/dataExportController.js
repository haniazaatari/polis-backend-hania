import { getDataExportUrl, requestDataExport } from '../services/export/dataExportService.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request for data export
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const handleDataExportRequest = async (req, res) => {
  try {
    await requestDataExport(req.p.uid, req.p.zid, req.p.unixTimestamp, req.p.format);
    res.json({});
  } catch (err) {
    fail(res, 500, 'polis_err_data_export123', err);
  }
};

/**
 * Handle GET request for data export results
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const handleDataExportResults = (req, res) => {
  try {
    const url = getDataExportUrl(req.p.filename);
    res.redirect(url);
  } catch (err) {
    fail(res, 500, 'polis_err_data_export_results', err);
  }
};
