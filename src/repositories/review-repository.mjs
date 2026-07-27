export class ReviewRepository {
  async findItems(_filters) {
    throw new Error('ReviewRepository.findItems must be implemented');
  }

  async updateDecision(_sourcePath, _decision) {
    throw new Error('ReviewRepository.updateDecision must be implemented');
  }

  async close() {}
}
