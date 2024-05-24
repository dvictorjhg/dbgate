const crypto = require('crypto');
const path = require('path');
const { uploadsdir, getLogsFilePath } = require('../utility/directories');
const { getLogger } = require('dbgate-tools');
const logger = getLogger('uploads');
const axios = require('axios');
const os = require('os');
const fs = require('fs/promises');
const { read } = require('./queryHistory');
const platformInfo = require('../utility/platformInfo');
const _ = require('lodash');
const serverConnections = require('./serverConnections');

module.exports = {
  upload_meta: {
    method: 'post',
    raw: true,
  },
  upload(req, res) {
    const { data } = req.files || {};
    if (!data) {
      res.json(null);
      return;
    }
    const uploadName = crypto.randomUUID();
    const filePath = path.join(uploadsdir(), uploadName);
    logger.info(`Uploading file ${data.name}, size=${data.size}`);

    data.mv(filePath, () => {
      res.json({
        originalName: data.name,
        uploadName,
        filePath,
      });
    });
  },

  get_meta: {
    method: 'get',
    raw: true,
  },
  get(req, res) {
    res.sendFile(path.join(uploadsdir(), req.query.file));
  },

  uploadErrorToGist_meta: true,
  async uploadErrorToGist() {
    const logs = await fs.readFile(getLogsFilePath(), { encoding: 'utf-8' });
    const connections = await serverConnections.getOpenedConnectionReport();
    try {
      const response = await axios.default.post(
        'https://api.github.com/gists',
        {
          description: 'DbGate error report',
          public: false,
          files: {
            'logs.jsonl': {
              content: logs,
            },
            'os.json': {
              content: JSON.stringify(
                {
                  release: os.release(),
                  arch: os.arch(),
                  machine: os.machine(),
                  platform: os.platform(),
                  type: os.type(),
                },
                null,
                2
              ),
            },
            'platform.json': {
              content: JSON.stringify(
                _.omit(
                  {
                    ...platformInfo,
                  },
                  ['defaultKeyfile', 'sshAuthSock']
                ),
                null,
                2
              ),
            },
            'connections.json': {
              content: JSON.stringify(connections, null, 2),
            },
          },
        },
        {
          headers: {
            Authorization: `token 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`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      return response.data;
    } catch (err) {
      logger.error({ err }, 'Error uploading gist');

      return {
        apiErrorMessage: err.message,
      };
      // console.error('Error creating gist:', error.response ? error.response.data : error.message);
    }
  },

  deleteGist_meta: true,
  async deleteGist({ url }) {
    const response = await axios.default.delete(url, {
      headers: {
        Authorization: `token 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`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
      },
    });
    return true;
  },
};
