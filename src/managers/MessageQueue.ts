import { Message, BrowserLocation } from '../porter.model';
import { Logger } from '../porter.utils';

interface QueuedMessage {
  message: Message<any>;
  target?: BrowserLocation;
  timestamp: number;
}

export class MessageQueue {
  private queue: QueuedMessage[] = [];
  private readonly logger: Logger;
  private readonly maxQueueSize: number = 1000; // Prevent memory issues
  private readonly maxMessageAge: number = 5 * 60 * 1000; // 5 minutes

  constructor(logger: Logger) {
    this.logger = logger;
    this.logger.debug('MessageQueue initialized', {
      maxQueueSize: this.maxQueueSize,
      maxMessageAge: `${this.maxMessageAge / 1000} seconds`,
    });
  }

  public enqueue(message: Message<any>, target?: BrowserLocation): void {
    // Remove old messages
    const oldCount = this.queue.length;
    this.cleanup();
    if (oldCount !== this.queue.length) {
      this.logger.debug(
        `Cleaned up ${oldCount - this.queue.length} old messages`
      );
    }

    // Check if queue is full
    if (this.queue.length >= this.maxQueueSize) {
      this.logger.warn('Message queue is full, dropping oldest message', {
        queueSize: this.queue.length,
        maxSize: this.maxQueueSize,
      });
      this.queue.shift();
    }

    this.queue.push({
      message,
      target,
      timestamp: Date.now(),
    });

    this.logger.debug('Message queued', {
      queueSize: this.queue.length,
      message,
      target,
      timestamp: new Date().toISOString(),
    });
  }

  public dequeue(): QueuedMessage[] {
    const messages = [...this.queue];
    this.queue = [];
    this.logger.info(`Dequeued ${messages.length} messages`, {
      oldestMessage: messages[0]
        ? new Date(messages[0].timestamp).toISOString()
        : null,
      newestMessage: messages[messages.length - 1]
        ? new Date(messages[messages.length - 1].timestamp).toISOString()
        : null,
    });
    return messages;
  }

  public isEmpty(): boolean {
    return this.queue.length === 0;
  }

  private cleanup(): void {
    const now = Date.now();
    const oldCount = this.queue.length;
    this.queue = this.queue.filter(
      (item) => now - item.timestamp < this.maxMessageAge
    );
    if (oldCount !== this.queue.length) {
      this.logger.debug(
        `Cleaned up ${oldCount - this.queue.length} expired messages`,
        {
          remaining: this.queue.length,
          maxAge: `${this.maxMessageAge / 1000} seconds`,
        }
      );
    }
  }
}
