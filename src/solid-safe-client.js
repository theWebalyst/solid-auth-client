// @flow
/* global fetch */
import EventEmitter from 'events'
import type { Session } from './session'
import { getSession, saveSession, clearSession } from './session'
import type { AsyncStorage } from './storage'
import { defaultStorage } from './storage'
import { toUrlString, currentUrlNoParams } from './url-util'

const safeJs = require('safenetworkjs').safeJs

let safeWeb // SAFE Web API (experimental WebID support etc.)

// Store the global fetch, so the user is free to override it
const globalFetch = fetch

// Default appInfo is worded to encourage app developers to
// provide this from their app via loginOptions (see below).
// For connection without authorisation (see initUnauthorised())
const defaultAppInfo = {
  id: 'Unidentified solid-auth-client app',
  name: 'WARNING: do not click Accept unless you trust this app',
  vendor: 'solid-auth-client app'
}

export type loginOptions = {
  callbackUri: string,
  popupUri: string,
  storage: AsyncStorage,
  safeAppInfo: { id: string, name: string, vendor: string}
}

export default class SolidSafeClient extends EventEmitter {
  _pendingSession: ?Promise<?Session>

  constructor() {
    super()
    this.setSafeAppInfo(defaultAppInfo)
    this.safeJs = safeJs
  }

  // Can be used by app to set appInfo if not passed via loginOptions
  setSafeAppInfo(appInfo) {
    this.safeAppInfo = appInfo
    safeJs.untrustedAppInfo = appInfo
  }

  fetch(input: RequestInfo, options?: RequestOptions): Promise<Response> {
    console.log('sac: fetch(%s, %O)', input, options)

    this.emit('request', toUrlString(input))
    return safeJs.fetch(input, options)
  }

  // Apps which access session before logging in trigger a default
  // authorisation process in order to initialse the SAFE App object
  async defaultLogin() {
    return this.login('', {undefined, undefined, undefined, safeAppInfo: this.safeAppInfo})
  }

  async login(idp: string, options: loginOptions): Promise<?Session> {
    console.log('sac: login(idp:\'%s\', loginOptions:\'%o\')', idp, options)

    // Handle change to currentWebId
    window.webIdEventEmitter.on('update', async (safeWebID) => {
      console.log('sac: safeWebID from update', safeWebID)
      let session = this.makeSessionObject(safeWebID)
      // await saveSession(options.storage)(session)
      this.emit('login', session)
      this.emit('session', session)
    })

    let appInfo = options.safeAppInfo
    if (appInfo === undefined ) appInfo = this.safeAppInfo
    if (appInfo === defaultAppInfo) {
      console.log('sac: WARNING: app has not set safeAppInfo')
    }

    if (!safeJs.isAuthorised()) await safeJs.initAuthorised(appInfo)

    if (safeJs.isAuthorised()) {
      try {
        safeWeb = safeJs.safeApp.web
        // getWebIds() generates error, safe_app_nodejs issue #374
        // https://github.com/maidsafe/safe_app_nodejs/issues/374
        console.log('sac:WebIds: %o', await safeWeb.getWebIds())
      } catch (e) {
        console.log('sac: ERROR from safeWeb.getWebIds(): ', e)
      }
    }

    let session
    if (safeJs.isAuthorised()) {
      session = this.makeSessionObject(window.currentWebId)
      await saveSession(options.storage)(session)
      this.emit('login', session)
      this.emit('session', session)
    }

    return session
  }

  async popupLogin(options: loginOptions): Promise<?Session> {
    console.log('sac: popupLogin(loginOptions:\'%o\')', options)
    options = { ...defaultLoginOptions(), ...options }
    return this.login('', options)

    // options = { ...defaultLoginOptions(), ...options }
    // if (!/https?:/.test(options.popupUri)) {
    //   options.popupUri = new URL(
    //     options.popupUri || '/.well-known/solid/login',
    //     window.location
    //   ).toString()
    // }
    // if (!options.callbackUri) {
    //   options.callbackUri = options.popupUri
    // }
    // const popup = openIdpPopup(options.popupUri)
    // const session = await obtainSession(options.storage, popup, options)
    // this.emit('login', session)
    // this.emit('session', session)
    // return session
  }

  /**
   * get current login session object
   *
   * If an object is returned, it implies the SAFE user is logged in *and*
   * has a SAFE WebID selected. If either is not true, the return will
   * be 'undefined'.
   *
   * NOTES:
   * On Solid being logged in implies a given identity (WebID) whereas on
   * SAFE a given account has multiple SAFE WebIDs. The SAFE user can select
   * a WebID for use with the app, or have no ID selected.
   *
   * A session object for SAFE indicates the app has initAuthorised(),
   * which is the SAFE equivalent of user having active login session
   * on the web.
   *
   * Web apps which reload the page are catered for by storing the session
   * in browser storage, and then attempting to retrieve this when
   * currentSession() is called. If that fails, an undefined return
   * lets the app know it must login before the user can access storage.
   *
   * The user will also have to select a SAFE WebID, or the app will continue
   * to think they have not logged in.
   *
   * @type {AsyncStorage} browser storage
   *
   * returns Promise a session object, or undefined if not logged in
   */
  async currentSession(
    storage: AsyncStorage = defaultStorage()
  ): Promise<?Session> {
    // Use saveSession() / getSession() to track Solid login() state
    let session = await getSession(storage)
    if (session) {
      session = await this.safeCurrentSession()
      console.log('sac: currentSession() returning: ', session)
      // Save the new session and emit session events
      if (session) {
        await saveSession(storage)(session)
        this.emit('login', session)
        this.emit('session', session)
      }
    }
    return session
    // // Try to obtain a stored or pending session
    // let session = this._pendingSession || (await getSession(storage))
    //
    // // If none found, attempt to create a new session
    // if (!session) {
    //   // Try to create a new OIDC session from stored tokens
    //   try {
    //     this._pendingSession = WebIdOidc.currentSession(storage)
    //     session = await this._pendingSession
    //   } catch (err) {
    //     console.error(err)
    //   }
    //
    //   // Save the new session and emit session events
    //   if (session) {
    //     await saveSession(storage)(session)
    //     this.emit('login', session)
    //     this.emit('session', session)
    //   }
    //   delete this._pendingSession
    // }
    // return session
  }

  async safeCurrentSession() {
    if (!safeJs.isAuthorised() && safeJs.safeApi.loadAuthUri(this.safeAppInfo.id)) {
      // Attempt silent authorisation for web apps reloading page:
      await this.defaultLogin()
    }

    let webId = window.currentWebId
    if (webId === undefined) {
      // Make sure SAFE App is initialised as this would explain
      // why we could not obtain a webId from SAFE Browser
      //
      // TODO this is disabled because it breaks apps which must work
      // TODO without user being logged in (e.g. visitor to a blog)
      // return this.defaultLogin()
    }

    let currentSession
    if (safeJs.isAuthorised()) currentSession = this.makeSessionObject(webId)

    console.log('sac: safeCurrentSession() returning: ', currentSession)
    return currentSession
  }

  makeSessionObject(safeWebID) {
    console.log('sac: makeSessionObject(' + safeWebID + ')')

    let safeSession
    if (safeWebID === undefined || safeWebID === '') {
      console.log('sac: WARNING: invalid safeWebID ' + safeWebID)
    } else if (safeJs.isAuthorised()) {
      let webID = (safeWebID ? safeWebID['#me']['@id'] : '')
      safeSession = {
        'webId': webID,

        // To pass type checks we add redundant OIDC session members:
        accessToken: 'undefined',
        clientId: 'undefined',
        idToken: 'undefined',
        idp: 'undefined',
        sessionKey: 'undefined'
      }
    }

    // User must login to SAFE *and* have a WebID selected or we appear NOT logged in to app.
    console.log('sac: returning session: ', safeSession)
    return safeSession
  }

  async trackSession(callback: Function): Promise<void> {
    console.log('sac: currentSession()')
    // /* eslint-disable standard/no-callback-literal */
    // callback(await this.currentSession())
    // this.on('session', callback)
    callback(await this.safeCurrentSession())
    this.on('session', callback)
  }

  async logout(storage: AsyncStorage = defaultStorage()): Promise<void> {
    console.log('sac: logout()')
    const session = await getSession(storage)
    if (session) {
      try {
        this.safeJs.safeApi.clearAuthUri(this.safeAppInfo.id)  // Forget app auth until login()

        // await WebIdOidc.logout(storage, globalFetch)
        this.emit('logout')
        this.emit('session', null)
      } catch (err) {
        console.warn('Error logging out:')
        console.error(err)
      }
      await clearSession(storage)
    }
  }
}

function defaultLoginOptions(url: ?string): loginOptions {
  return {
    callbackUri: url ? url.split('#')[0] : '',
    popupUri: '',
    storage: defaultStorage()
  }
}
