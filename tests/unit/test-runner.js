class PorterTestRunner {
    static async runAll() {
      await this.testBasicMessaging();
      await this.testErrorHandling();
      await this.testReconnection();
      // Add more test cases
    }
  
    static async testBasicMessaging() {
      // Test implementation
    }
  
    static async testErrorHandling() {
      // Test implementation
    }
  
    static async testReconnection() {
      // Test implementation
    }
  }
  
  // Auto-run tests when loaded
  PorterTestRunner.runAll().catch(console.error);