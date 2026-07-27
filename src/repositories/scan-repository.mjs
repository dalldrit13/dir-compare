export class ScanRepository {
  shouldExcludeSourcePath(_filePath) {
    return false;
  }

  async beginScan() {
    throw new Error('ScanRepository.beginScan must be implemented');
  }

  async saveFile(_file, _candidates) {
    throw new Error('ScanRepository.saveFile must be implemented');
  }

  async completeScan(_metadata) {
    throw new Error('ScanRepository.completeScan must be implemented');
  }

  async rollbackScan() {}

  async close() {}
}
