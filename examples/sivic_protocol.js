/**
 * Contains logic for sending mesages between the SIVIC creative and the player.
 * Note: Some browsers do not support promises and a more complete implementation
 *       should consider using a polyfill.
 */
class SivicProtocol {

  constructor() {
    /*
     * A map of messsage type to an array of callbacks.
     * @private {Map<String, Array<Function>>}
     */
    this.listeners_ = new Map();

    /*
     * The session ID for this protocol.
     * @private {String}
     */
    this.sessionId_ = '';

    /**
     * The next message ID to use when sending a message.
     * @private {number}
     */
    this.nextMessageId_ = 1;

    /**
     * The window where the message should be posted to.
     * @private {!Element}
     */
    this.target_ = window.parent;

    this.resolutionListeners_ = {};

    window.addEventListener('message',
        this.receiveMessage.bind(this), false);
  }

  /* Reverts this protocol to its original state */
  reset() {
    this.listeners_ = new Map();
    this.sessionId_ = '';
    this.nextMessageId_ = 1;
    // TODO: Perhaps we should reject all associated promises.
    this.resolutionListeners_ = {};
  }

  /**
   * Sends a message using post message.  Returns a promise
   * that will resolve or reject after the message receives a response.
   * @param {string} messageType The name of the message
   * @param {?Object} messageArgs The arguments for the message, may be null.
   * @return {!Promise} Promise that will be fulfilled when client resolves or rejects.
   */
  async sendMessage(messageType, messageArgs) {
    // Incrementing between messages keeps each message id unique.
    const messageId = this.nextMessageId_ ++;

    // Only create session does not need to be in the SIVIC name space
    // because it is part of the protocol.
    const nameSpacedMessage = 
        messageType == ProtocolMessage.CREATE_SESSION ?
            messageType : 'SIVIC:' + messageType;

    // The message object as defined by the SIVIC spec.
    const message = {
      'sessionId': this.sessionId_,
      'messageId': messageId,
      'type': nameSpacedMessage,
      'args': messageArgs
    }

    if (EventsThatRequireResponse.includes(messageType)) {
      // If the message requires a callback this code will set
      // up a promise that will call resolve or reject with its parameters.
      return new Promise((resolve, reject) => {
        this.addResolveRejectListener_(messageId, resolve, reject);
        this.target_.postMessage(JSON.stringify(message), '*');
      });
    }
    // A default promise will just resolve immediately.
    // It is assumed no one would listen to these promises, but if they do
    // it will "just work".
    return new Promise((resolve, reject) => {
      this.target_.postMessage(JSON.stringify(message), '*');
      resolve();
    });
	}

  /**
   * Adds a listener for a given message.
   */
  addListener(messageType, callback) {
    if (!this.listeners_[messageType]) {
      this.listeners_[messageType] = [callback];
    } else {
      this.listeners_[messageType].push(callback);
    }
  }

  /**
   * Sets up a listener for resolve/reject messages.
   * @private
   */
  addResolveRejectListener_(messageId, resolve, reject) {
    const listener = (data) => {
      if (data['type'] == 'resolve') {
        resolve(data['args']);
      } else if (data['type'] == 'reject') {
        reject(data['args']);
      }
    }
    this.resolutionListeners_[messageId] = listener.bind(this);
  }

  /**
   * Recieves messages from either the player or creative.
   */
  receiveMessage(event) {
    if (!event || !event.data) {
      return;
    }
    const data = JSON.parse(event.data);
    if (!data) {
      // If there is no data in the event this is not a SIVIC message.
      return;
    }
    const sessionId = data['sessionId'];

    const type = data['type'];
    // A sessionId is valid in one of two cases:
    // 1. It is not set and the message type is createSession.
    // 2. The session ids match exactly.
    const isCreatingSession = this.sessionId_ == '' && type == ProtocolMessage.CREATE_SESSION;
    const isSessionIdMatch = this.sessionId_ == sessionId;
    const validSessionId = isCreatingSession || isSessionIdMatch;

    if (!validSessionId || type == null) {
      // Ignore invalid messages.
      return;
    }

    // There are 2 types of messages to handle:
    // 1. Protocol messages (like resolve, reject and createSession)
    // 2. Messages starting with SIVIC:
    // All other messages are ignored.
    if (Object.values(ProtocolMessage).includes(type)) {
      this.handleProtocolMessage_(data);
    } else if (type.startsWith('SIVIC:')) {
      // Remove SIVIC: from the front of the message so we can compare them with the map.
      const specificType = type.substr(6);
      const listeners = this.listeners_[specificType];
      if (listeners) {
        // calls each of the listeners with the data.
        listeners.forEach((listener) => listener(data));
      } else {
        // Typically this could be ignored, but this sample logs these
        // messages to find potential bugs.
        console.log('Unexpected message type ' + type);
      }
    }
  }

  /**
   * Handles incoming messages specifically for the protocol
   * @param {!Object} data Data passed back from the message
   * @private
   */
  handleProtocolMessage_(data) {
    const type = data['type'];
    switch (type) {
      case ProtocolMessage.CREATE_SESSION:
        this.sessionId_ = data['sessionId'];
        this.resolve(data);
        const listeners = this.listeners_[type];
        if (listeners) {
          // calls each of the listeners with the data.
          listeners.forEach((listener) => listener(data));
        }
        break;
      case ProtocolMessage.RESOLVE:
        // intentional fallthrough
      case ProtocolMessage.REJECT:
        const messageId = data['messageId'];
        const resolutionFunction = this.resolutionListeners_[messageId];
        if (resolutionFunction) {
          // If the listener exists call it once only.
          resolutionFunction(data);
          delete this.resolutionListeners_[messageId];
        }
        break;
    } 
  }


  /**
   * Resolves an incoming message.
   * @param {!Object} incomingMessage the message that is being resolved.
   * @param {!Object} outgoingArgs Any arguments that are part of the resolution.
   */
  resolve(incomingMessage, outgoingArgs) {
    const messageId = incomingMessage['messageId'];
    const message = {
      'sessionId': this.sessionId_,
      'messageId': messageId,
      'type': ProtocolMessage.RESOLVE,
      'args': outgoingArgs
    }
    this.target_.postMessage(JSON.stringify(message), '*');
  }

  /**
   * Rejects an incoming message.
   * @param {!Object} incomingMessage the message that is being resolved.
   * @param {!Object} outgoingArgs Any arguments that are part of the resolution.
   */
  reject(incomingMessage, outgoingArgs) {
    const messageId = incomingMessage['messageId'];
    const message = {
      'sessionId': this.sessionId_,
      'messageId': messageId,
      'type': ProtocolMessage.REJECT,
      'args': outgoingArgs
    }
    this.target_.postMessage(JSON.stringify(message), '*');
  }

  /**
   * Creates a new session.
   * @param {String} sessionId
   * @return {!Promise} The promise from the create session message.
   */
  createSession() {
    const sessionCreationResolved = () => {
        console.log('Session created.');
    }
    const sessionCreationRejected = () => {
      // If this ever happens, it may be impossible for the ad
      // to ever communicate with the player.
      console.log('Session creation was rejected.');
    }
    this.generateSessionId_();
    this.sendMessage(ProtocolMessage.CREATE_SESSION).then(
      sessionCreationResolved, sessionCreationRejected);
  }

  /**
   * Sets the session ID, this should only be used on session creation.
   * @private
   */
  generateSessionId_() {
    let dt = new Date().getTime();
    const generateRandomHex = (c) => {
      const r = (dt + Math.random()*16)%16 | 0;
      dt = Math.floor(dt/16);
      return (c=='r' ? r :(r&0x3|0x8)).toString(16);
    };
    const uuidFormat = 'rrrrrrrr-rrrr-4rrr-yrrr-rrrrrrrrrrrr';
    const uuid = uuidFormat.replace(/[ry]/g, generateRandomHex);
    this.sessionId_ = uuid;
  }

  setMessageTarget(target) {
    this.target_ = target;
  }
}


ProtocolMessage = {
  CREATE_SESSION: 'createSession',
  RESOLVE: 'resolve',
  REJECT: 'reject'
}

/** Contains all constants common across SIVIC */

VideoMessage = {
  DURATION_CHANGE: 'Video:durationchange',
  ENDED: 'Video:ended',
  ERROR: 'Video:error',
  PAUSE: 'Video:pause',
  PLAY: 'Video:play',
  PLAYING: 'Video:playing',
  SEEKED: 'Video:seeked',
  SEEKING: 'Video:seeking',
  TIME_UPDATE: 'Video:timeupdate',
  VOLUME_CHANGE: 'Video:volumechange',
};

PlayerMessage = {
  RESIZE: 'Player:resize',
  INIT: 'Player:init',
  START_CREATIVE: 'Player:startCreative',
  AD_SKIPPED: 'Player:adSkipped',
  AD_STOPPED: 'Player:adStopped',
  FATAL_ERROR: 'Player:fatalError',
};

/** Messages from the creative */
CreativeMessage = {
  CLICK_THRU: 'Creative:clickThru',
  FATAL_ERROR: 'Creative:fatalError',
  GET_VIDEO_STATE: 'Creative:getVideoState',
  REQUEST_FULL_SCREEN: 'Creative:requestFullScreen',
  REQUEST_SKIP: 'Creative:requestSkip',
  REQUEST_STOP: 'Creative:requestStop',
  REQUEST_PAUSE: 'Creative:requestPause',
  REQUEST_PLAY: 'Creative:requestPlay',
  REQUEST_RESIZE: 'Creative:requestResize',
  REQUEST_VOLUME: 'Creative:requestVolume',
  REQUEST_TRACKING: 'Creative:reportTracking',
  REQUEST_CHANGE_AD_DURATION: 'Creative:requestChangeAdDuration',
};

/* Tracking messages supported by the vast spec. Sent from the
 * player to the creative.
 */
TrackingMessages = {
  CLICK_THROUGH: 'Tracking:clickThrough',
  CLICK_TRACKING: 'Tracking:clickTracking',
  CLOSE_LINEAR: 'Tracking:closeLinear',
  COLLAPSE: 'Tracking:collapse',
  COMPLETE: 'Tracking:complete',
  CREATIVE_VIEW: 'Tracking:creativeView',
  CUSTOM_CLICK: 'Tracking:customClick',
  EXIT_FULL_SCREEN: 'Tracking:exitFullscreen',
  EXPAND: 'Tracking:expand',
  FIRST_QUARTILE: 'Tracking:firstQuartile',
  FULL_SCREEN: 'Tracking:fullscreen',
  IMPRESSION: 'Tracking:impression',
  LOADED: 'Tracking:loaded',
  MIDPOINT: 'Tracking:midpoint',
  MUTE: 'Tracking:mute',
  OTHER_AD_INTERACTION: 'Tracking:otherAdInteraction',
  PAUSE: 'Tracking:pause',
  PLAYER_COLLAPSE: 'Tracking:playerCollapse',
  PLAYER_EXPAND: 'Tracking:playerExpand',
  PROGRESS: 'Tracking:progress',
  RESUME: 'Tracking:resume',
  REWIND: 'Tracking:rewind',
  SKIP: 'Tracking:skip',
  START: 'Tracking:start',
  THIRD_QUARTILE: 'Tracking:thirdQuartile',
  UNMUTE: 'Tracking:unmute',
};

/**
 * These messages require a response (either resolve or reject).
 * All other messages do not require a response and are information only.
 */
EventsThatRequireResponse = [
  CreativeMessage.GET_VIDEO_STATE,
  CreativeMessage.REQUEST_VIDEO_LOCATION,
  CreativeMessage.READY,
  CreativeMessage.CLICK_THRU,
  CreativeMessage.REQUEST_SKIP,
  CreativeMessage.REQUEST_STOP,
  CreativeMessage.REQUEST_PAUSE,
  CreativeMessage.REQUEST_PLAY,
  CreativeMessage.REQUEST_FULL_SCREEN,
  CreativeMessage.REQUEST_FULL_VOLUME,
  CreativeMessage.REQUEST_FULL_RESIZE,
  CreativeMessage.REQUEST_CHANGE_AD_DURATION,
  CreativeMessage.REPORT_TRACKING,
  PlayerMessage.INIT,
  PlayerMessage.START_CREATIVE,
  PlayerMessage.AD_SKIPPED,
  PlayerMessage.AD_STOPPED,
  PlayerMessage.FATAL_ERROR,
  ProtocolMessage.CREATE_SESSION,
  VideoMessage.GET_VIDEO_STATE,
]

ErrorCode = {
  CANNOT_LOAD_RESOURCE: 1101,
  INCORRECT_INTERFACE: 1102,
  WRONG_DIMENSIONS: 1103,
  WRONG_HANDSHAKE: 1104,
  TECHNICAL_REASONS: 1105,
  EXPAND_NOT_POSSIBLE: 1106,
  PAUSE_NOT_HONORED: 1107,
  PLAYMODE_NOT_ADEQUATE: 1008,
  AD_INTERNAL_ERROR: 1009,
  DEVICE_NOT_SUPPORTED: 1010,
  PLAYER_CAPABILITIES_NOT_ADEQUATE: 1199,
  UNCAUGHT_ERROR: 1201,
  WRONG_HANDSHAKE2: 1202,  // TODO: This is a repeast
}
