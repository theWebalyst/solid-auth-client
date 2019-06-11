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

// TODO provide mechanism for appInfo to be obtained from the Solid app
// This should be obtained from the Solid app so it can be identifed
// in the SAFE Authenticator UI
const untrustedAppInfo = {
  id: 'Untrusted',
  name: 'Do NOT authorise this app',
  vendor: 'Untrusted'
}

function safeCurrentWebId() {
  return window.currentWebId
}

function safeCurrentSession() {
  return makeSessionObject(safeCurrentWebId())
}

function makeSessionObject(safeWebId) {
  let webId = (safeWebId ? safeWebId['#me']['@id'] : '')
  let safeSession = {
    'webId': webId,

    // To pass type checks we add redundant OIDC session members:
    accessToken: 'undefined',
    clientId: 'undefined',
    idToken: 'undefined',
    idp: 'undefined',
    sessionKey: 'undefined'
  }
  return (webId ? safeSession : undefined )
}

// Store the global fetch, so the user is free to override it
const globalFetch = fetch

export type loginOptions = {
  callbackUri: string,
  popupUri: string,
  storage: AsyncStorage
}

export default class SolidSafeClient extends EventEmitter {
  _pendingSession: ?Promise<?Session>

  fetch(input: RequestInfo, options?: RequestOptions): Promise<Response> {
    console.log('safe: fetch(%s, %O)', input, options)

    this.emit('request', toUrlString(input))
    return safeJs.fetch(input, options)
    // return authnFetch(defaultStorage(), globalFetch, input, options)
  }

  async login(idp: string, options: loginOptions): Promise<?Session> {
    console.log('safe: login(idp:\'%s\', loginOptions:\'%o\')', idp, options)

    // throw new Error('TODO implement %s.login()', this.constructor.name)
    // options = { ...defaultLoginOptions(currentUrlNoParams()), ...options }
    // return WebIdOidc.login(idp, options)

    // TODO remove checks on window if this stays here (was global)
    let session
    if (window && window.safe && !safeJs.isAuthorised()) {
      await safeJs.initAuthorised(untrustedAppInfo)
      if (safeJs.isAuthorised()) {
        safeWeb = safeJs.safeApp.web
        console.log('safe:WebIds: %o', safeWeb.getWebIds())

        window.webIdEventEmitter.on('update', (safeWebId) => {
          console.log('safe: safeWebId from update', safeWebId)
          let webId = safeWebId['#me']['@id']
          session = { 'webId': webId }
          // await saveSession(storage)(session)
          this.emit('login', session)
          this.emit('session', session)
        })
      }
    }
    return session
  }

  async popupLogin(options: loginOptions): Promise<?Session> {
    console.log('safe: popupLogin(loginOptions:\'%o\')', options)
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

  async currentSession(
    storage: AsyncStorage = defaultStorage()
  ): Promise<?Session> {
    console.log('safe: currentSession()')
    return safeCurrentSession()
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

  async trackSession(callback: Function): Promise<void> {
    console.log('safe: currentSession()')
    // /* eslint-disable standard/no-callback-literal */
    // callback(await this.currentSession())
    // this.on('session', callback)
    callback(safeCurrentSession())
    this.on('session', callback)
  }

  async logout(storage: AsyncStorage = defaultStorage()): Promise<void> {
    console.log('safe: logout()')
    // const session = await getSession(storage)
    // if (session) {
    //   try {
    //     await WebIdOidc.logout(storage, globalFetch)
    //     this.emit('logout')
    //     this.emit('session', null)
    //   } catch (err) {
    //     console.warn('Error logging out:')
    //     console.error(err)
    //   }
    //   await clearSession(storage)
    // }
  }
}

// function defaultLoginOptions(url: ?string): loginOptions {
//   return {
//     callbackUri: url ? url.split('#')[0] : '',
//     popupUri: '',
//     storage: defaultStorage()
//   }
// }
