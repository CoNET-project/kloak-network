/*!
 * Copyright 2018 CoNET Technology Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/// 
import * as Net from 'net'
import * as Tls from 'tls'
import * as Stream from 'stream'
import * as Event from 'events'
import * as Uuid from 'uuid'
import * as Async from 'async'
import * as Crypto from 'crypto'
import { Buffer } from 'buffer'
import * as Util from 'util'


const MAX_INT = 9007199254740992
const debug = true

const NoopLoopWaitingTime = 1000 * 1

export const saveLog = ( log: string, _console: boolean = true ) => {

    const data = `${ new Date().toUTCString () }: ${ log }\r\n`
    _console ? console.log ( data ) : null
}
const debugOut = ( text: string, isIn: boolean, serialID: string ) => {
    const log = `【${ new Date().toISOString()}】【${ serialID }】${ isIn ? '<=' : '=>'} 【${ text }】`
    console.log ( log )

}

const idleInterval = 1000 * 60 * 15    // 5 mins

class ImapServerSwitchStream extends Stream.Transform {

    public commandProcess ( text: string, cmdArray: string[], next, callback ) {}
    public name: string
    public _buffer = Buffer.alloc (0)
    public serverCommandError ( err: Error, CallBack ) {
        this.imapServer.emit ( 'error', err )
        if ( CallBack ) {
			CallBack ( err )
		}
            
    }

    public Tag: string = null
    public cmd: string = null
    public callback = false
    public doCommandCallback = null
    private _login = false
    private first = true
    public waitLogoutCallBack = null
    public idleResponsrTime: NodeJS.Timer = null
    private ready = false
    public appendWaitResponsrTimeOut: NodeJS.Timer = null
    public runningCommand = null
    //private nextRead = true
    public idleNextStop: NodeJS.Timer = null
    private reNewCount = 0
    private isImapUserLoginSuccess = false
	
    private newSwitchRet = false
    private doingIdle = false
    private needLoginout = null

	private idleDoingDown () {
        if ( !this.doingIdle || this.runningCommand !== 'idle' ) {
            return //console.dir (`idleDoingDown stop because this.doingIdle === false!`)
        }
        this.doingIdle = false

		clearTimeout ( this.idleNextStop )
		
		if ( this.writable ) {
			
            this.debug ? debugOut ( `DONE`, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
            console.log('')
			return this.push (`DONE\r\n`)
        }
        /**
         *          
         */
		return this.imapServer.destroyAll ( null )
		
    }
    
    constructor ( public imapServer, private exitWithDeleteBox: boolean, public debug: boolean  ) {
        super ()
    }

    private doCapability ( capability ) {
        this.imapServer.serverSupportTag = capability
        this.imapServer.idleSupport = /IDLE/i.test ( capability )
        this.imapServer.condStoreSupport = /CONDSTORE/i.test ( capability )
        this.imapServer.literalPlus = /LITERAL\+/i.test ( capability )
        const ii = /X\-GM\-EXT\-1/i.test ( capability )
        const ii1 = /CONDSTORE/i.test ( capability )
        return this.imapServer.fetchAddCom = `(${ ii ? 'X-GM-THRID X-GM-MSGID X-GM-LABELS ': '' }${ ii1 ? 'MODSEQ ' : ''}BODY[])`
    }

    public preProcessCommane ( commandLine: string, _next, callback ) {
		commandLine = commandLine.replace( /^ +/g,'').replace (/^IDLE\*/, '*')
		const cmdArray = commandLine.split (' ')
		
        this.debug ? debugOut ( `${commandLine}`, true, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
		
        if ( this._login ) {
            switch ( commandLine[0] ) {

                case '+':                                    /////       +
                case '*': {                                  /////       *
                    return this.commandProcess ( commandLine, cmdArray, _next, callback )
                }

                case 'I':           //  IDLE
                case 'D':           //  NODE
				case 'N':           //  NOOP
				case 'O': 			//	OK
                case 'A': {                                  /////       A
                    clearTimeout ( this.appendWaitResponsrTimeOut )
                    clearTimeout ( this.idleResponsrTime )
					this.runningCommand = false
					
                    
                    if ( /^ok$/i.test ( cmdArray[1] ) || /^ok$/i.test ( cmdArray[0] )) {
                        
                        this.doCommandCallback ( null, commandLine )
                        return callback ()
					}
					if ( this.Tag !== cmdArray[0] ) {
                        return this.serverCommandError ( new Error ( `this.Tag[${ this.Tag }] !== cmdArray[0] [${ cmdArray[0] }]\ncommandLine[${ commandLine }]` ), callback )
                    }
					//console.log (`IMAP preProcessCommane on NO Tag!`, commandLine )
                    const errs = cmdArray.slice (2).join(' ')
                    this.doCommandCallback ( new Error ( errs ))
                    return callback ()

                }
                default:
                    return this.serverCommandError ( new Error (`_commandPreProcess got switch default error!` ), callback )
            }
        }
        return this.login ( commandLine, cmdArray, _next, callback )
    }

    public checkFetchEnd () {

        if ( this._buffer.length <= this.imapServer.fetching ) {
            return null
        }
        
        const body = this._buffer.slice ( 0, this.imapServer.fetching )
        const uu = this._buffer.slice ( this.imapServer.fetching )
        
        let index1 = uu.indexOf ('\r\n* ')
        let index = uu.indexOf ('\r\nA') 

        index = index < 0 || index1 > 0 && index > index1 ? index1 : index

        if ( index < 0 )
            return null

        this._buffer = uu.slice ( index + 2 )
        this.imapServer.fetching = null
        return body
        
    }

    public _transform ( chunk: Buffer, encoding, next ) {
        
        this.callback = false
        //console.log ('************************************** ImapServerSwitchStream _transform chunk **************************************')
        //console.log ( chunk.toString ())
        //console.log ('************************************** ImapServerSwitchStream _transform chunk **************************************')
        this._buffer = Buffer.concat ([ this._buffer, chunk ])
        
        const doLine = () => {
            const __CallBack = () => {
                
                let index = -1
                if ( !this._buffer.length || (index = this._buffer.indexOf ( '\r\n' )) < 0 ) {
                    if ( !this.callback ) {
                        //      this is for IDLE do DONE command
                        //this.emit ( 'hold' )
                        this.callback = true
                        return next()
                    }
                    //      did next with other function
                    return
                }

                const _buf = this._buffer.slice ( 0, index )
                if ( _buf.length ) {
                    return this.preProcessCommane ( _buf.toString (), next, () => {
                        this._buffer = this._buffer.slice ( index + 2 )
                        return doLine ()
                    })
                }
                if (! this.callback ) {
                    this.callback = true
                    return next()
                }
                return
            }

            if ( this.imapServer.fetching ) {
                //console.log ('************************************** ImapServerSwitchStream _transform chunk **************************************')
                //console.log ( this._buffer.toString ())
                //console.log ('************************************** ImapServerSwitchStream _transform chunk **************************************')
                const _buf1 = this.checkFetchEnd ()
                
                //  have no fill body get next chunk
                if ( ! _buf1 ) {
                    if ( !this.callback ) {
                        this.callback = true
                        return next ()
                    }
                    return
                }
                /*
                console.log ('************************************** ImapServerSwitchStream _transform chunk **************************************')
                console.log ( _buf1.length )
                console.log ( _buf1.toString ())
                */
                
                
                this.imapServer.newMail ( _buf1 )
                
            }
            return __CallBack ()
        }

        return doLine ()
    }

    private capability () {

        this.doCommandCallback = ( err ) => {

            if ( this.imapServer.listenFolder ) {
                
                return this.createBox ( true, this.imapServer.listenFolder, ( err, newMail, UID: string ) => {
                    
                    if ( err ) {
                        console.log (`========================= [${ this.imapServer.listenFolder || this.imapServer.imapSerialID }] openBox Error do this.end ()`, err )
                        return this.imapServer.destroyAll( err )
                    }
                    /*
                    if ( this.isWaitLogout ) {
                        console.log (`capability this.waitLogout = true doing logout_process ()`)
                        return this.logout_process ( this.waitLogoutCallBack )
                    }
                    */
                    if ( /^inbox$/i.test ( this.imapServer.listenFolder )) {
                        console.log (`capability open inbox !`)
                        this.ready = true
                        return this.imapServer.emit ( 'ready' )
                    }

					if ( this.imapServer.skipOldMail ) {
						return this.skipAllUnreadMail ()
					}

                    if ( newMail && typeof this.imapServer.newMail === 'function') {
                        
                        //this.imapServer.emit ( 'ready' )
                        //console.log (`[${ this.imapServer.imapSerialID }]capability doing newMail = true`)
                        return this.doNewMail ( UID )
                    }
                    
                    if ( typeof this.imapServer.newMail === 'function' ) {
                        this.idleNoop ()
                    }
                    this.ready = true
                    this.imapServer.emit ( 'ready' )
                })
            }

            this.ready = true
            this.imapServer.emit ( 'ready' )
        }

        this.commandProcess = ( text: string, cmdArray: string[], next, callback ) => {
            switch ( cmdArray[0] ) {
                case '*': {                                  /////       *
                    //          check imap server is login ok
                    if ( /^CAPABILITY$/i.test ( cmdArray [1] ) && cmdArray.length > 2 ) {
                        const kkk = cmdArray.slice (2).join (' ')
                        this.doCapability ( kkk )
                    }
                    return callback ()
                }
                default:
                return callback ()
            }
        }

        this.Tag = `A${ this.imapServer.TagCount1() }`
        this.cmd = `${ this.Tag } CAPABILITY`
        this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null

        if ( this.writable ) {
			return this.push ( this.cmd + '\r\n')
		}
            
        return this.imapServer.destroyAll( null)
    }

	private skipAllUnreadMail () {

		return this.seachUnseen (( err, newMailIds, havemore ) => {
			if ( newMailIds ) {
				

				return Async.series ([
					next => this.flagsDeleted ( newMailIds, next ),
					next => this.expunge ( next )
				], err => {
					this.runningCommand = null
						this.imapServer.emit ( 'ready' )
						return this.idleNoop()
				})
				/*
				return Async.eachSeries ( uids, ( n: string , next ) => {
                    
					if ( n && n.length ) {
						return this.flagsDeleted ( n, next )
					}
					return next ( false )
                }, err => {
					return this.expunge ( err => {
						this.runningCommand = null
						this.imapServer.emit ( 'ready' )
						return this.idleNoop()
					})
				})
				*/
			}
			this.runningCommand = null
			this.imapServer.emit ( 'ready' )
			return this.idleNoop()
		})
	}

    public doNewMail ( UID = '' ) {

        this.reNewCount --
               
        this.runningCommand = 'doNewMail'
        return this.seachUnseen (( err, newMailIds, havemore ) => {
            if ( err ) {
                console.log (`===============> seachUnseen got error. destore imap connect!`, err )
                this.runningCommand = null
                return this.imapServer.destroyAll ( err )
            }
            
            let haveMoreNewMail = false
            
			const getNewMail = ( _fatchID, CallBack ) => {
            
				return Async.waterfall ([
					next => this.fetch ( _fatchID, next ),
					( _moreNew, next ) => {
						haveMoreNewMail = _moreNew
						return this.flagsDeleted ( _fatchID, next )
					},
					next => {
						return this.expunge ( next )
					}
				], CallBack )
            }
            
            if ( newMailIds || ( newMailIds = UID )) {
                const uids = newMailIds.split(',')
                return Async.eachSeries ( uids, ( n: string ,next ) => {
                    const _uid = parseInt ( n )
					if ( _uid > 0 ) {
						return getNewMail ( _uid, next )
					}
					return next ()
                }, err => {
                    console.log (`doNewMail Async.eachSeries getNewMail callback!`)
                    this.runningCommand = null
					if ( err ) {
                        console.log (`doNewMail Async.eachSeries getNewMail error`, err )
                        debug ? saveLog ( `ImapServerSwitchStream [${ this.imapServer.listenFolder || this.imapServer.imapSerialID }] doNewMail ERROR! [${ err }]`) : null
                        
						return this.imapServer.destroyAll ( err )
                    }

                    if ( this.needLoginout ) {
                        console.log (`this.needLoginout === true!`)
                        return this.idleNoop ( )
                    }

					if ( haveMoreNewMail || havemore || this.newSwitchRet ) {
						
						return this.doNewMail ()
                    }
                    
					return this.idleNoop ( )
                })
            }

            this.runningCommand = null
			this.imapServer.emit ( 'ready' )
			return this.idleNoop()
        })
    }

    private idleNoop () {
        if ( this.needLoginout ) {
            return this._logoutWithoutCheck (() => {

            })
        }
		this.newSwitchRet = false
		this.doingIdle = true
        this.runningCommand = 'idle'
        if ( ! this.ready ) {
            this.ready = true
            this.imapServer.emit ( 'ready' )
		}
		
        this.doCommandCallback = ( err => {

			
            if ( err ) {
				console.log (`IDLE doCommandCallback! error`, err )
                return this.imapServer.destroyAll ( err )
            }
            
            this.runningCommand = null
            if ( this.needLoginout ) {
                return this._logoutWithoutCheck (() => {
                    this.needLoginout ()
                })
            }

            //console.log(`IDLE DONE newSwitchRet = [${newSwitchRet}] nextRead = [${this.nextRead}]`)
            if ( this.newSwitchRet || this.reNewCount > 0 ) {
                return this.doNewMail ()
            }
            
            if ( this.imapServer.idleSupport ) {
                return this.idleNoop ()
			}
			/**
			 * NOOP support
			 */
			setTimeout (() => {
				if ( !this.runningCommand ) {
					return this.idleNoop ()
				}
				
			},  NoopLoopWaitingTime )

        })
			
        this.commandProcess = (  text: string, cmdArray: string[], next, callback ) => {
			//console.log (`idleNoop commandProcess coming ${ text }\n${ cmdArray }`)
            switch ( cmdArray[0] ) {
                case `${ this.Tag }*`:
                case '+':
                case '*': {
                    clearTimeout ( this.idleResponsrTime )
                    
					if ( /^RECENT$|^EXISTS$/i.test ( cmdArray[2] )) {
						this.newSwitchRet = true
						
						if ( this.imapServer.idleSupport ) {
							this.idleDoingDown()
						}
						
					}
                    return callback ()
                }
                default:
                return callback ()
            }
        }
        
        const name = this.Tag = this.imapServer.idleSupport ? 'IDLE' : 'NOOP'
        
        this.cmd = `${ this.Tag } ${ name }`
        
        this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null

        if ( this.writable ) {

            this.idleNextStop = this.imapServer.idleSupport
            ? setTimeout (() => {
				this.idleDoingDown()
            }, idleInterval )
            : null
            
            return this.push ( this.cmd + '\r\n')
        }
        this.doingIdle = false

        
        return this.imapServer.destroyAll ( null )
        
    }

    public loginoutWithCheck ( CallBack ) {
        if ( this.needLoginout ) {
            return CallBack ()
        }
        this.needLoginout = CallBack
        if ( this.runningCommand === 'doNewMail' ) {
            return
        }
        if ( this.doingIdle ) {
            return this.idleDoingDown ()
        }
        
    }

    private login ( text: string, cmdArray: string[], next, _callback ) {

        this.doCommandCallback = ( err: Error ) => {
            
            if ( ! err ) {
                this.isImapUserLoginSuccess = true
                return this.capability ()
            }
            console.log (`ImapServerSwitchStream class login error `, err )
            return this.imapServer.destroyAll ( err )
        }

        this.commandProcess = (  text: string, cmdArray: string[], next, callback ) => {
            switch ( cmdArray[0] ) {
                case '+':
                case '*': {
                    return callback ()
                }
                default:
                return callback ()
            }
        }
        
        switch ( cmdArray[0] ) {
            
            case '*': {                                  /////       *
                //          check imap server is login ok
                if ( /^ok$/i.test ( cmdArray [1]) && this.first ) {
                    this.first = false
                    this.Tag = `A${ this.imapServer.TagCount1() }`
                    this.cmd = `${ this.Tag } LOGIN "${ this.imapServer.IMapConnect.imapUserName }" "${ this.imapServer.IMapConnect.imapUserPassword }"`
                    this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
                    this.callback = this._login = true
                    if ( this.writable ) {
                        return next ( null, this.cmd + '\r\n' )
                    }
                        
                    this.imapServer.destroyAll ( null )
                }
                //
                return _callback ()
            }
            default:
            
            return this.serverCommandError ( new Error ( `login switch default ERROR!` ), _callback )
        }

    }

    public createBox ( openBox: boolean, folderName: string, CallBack ) {

        this.doCommandCallback = ( err ) => {
            if ( err ) {
                if ( err.message && !/exists/i.test ( err.message )) {
                    return CallBack ( err )
                }
                
            }
                
            if ( openBox ) {
                return this.openBox ( CallBack )
            }
            return CallBack ()
		}
		
        this.commandProcess = ( text: string, cmdArray: string[], next, callback ) => {
            return callback ()
		}
		
        this.Tag = `A${ this.imapServer.TagCount1() }`
        this.cmd = `${ this.Tag } CREATE "${ folderName }"`
        this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
        if ( this.writable ) {
            return this.push ( this.cmd + '\r\n')
        }
        
        return this.imapServer.destroyAll ( null )

    }

    public openBox ( CallBack ) {
		this.newSwitchRet = false
		let UID = 0
        this.doCommandCallback = ( err ) => {
            if ( err ) {
                return this.createBox ( true, this.imapServer.listenFolder, CallBack )
            }
            CallBack ( null, this.newSwitchRet, UID )
        }

        this.commandProcess = ( text: string, cmdArray: string[], next, _callback ) => {
            switch ( cmdArray[0] ) {
                case '*': {
                    if ( /^EXISTS$|^UIDNEXT$|UNSEEN/i.test ( cmdArray [2])) {
						const _num = text.split ('UNSEEN ')[1]
						if ( _num ) {
							
							UID = parseInt ( _num.split (']')[0])
						}
                        this.newSwitchRet = true
                        
                    }
                    return _callback ()
                }
                default:
                return _callback ()
            }
        }

        const conText = this.imapServer.condStoreSupport ? ' (CONDSTORE)' : ''
        
        this.Tag = `A${ this.imapServer.TagCount1() }`
        this.cmd = `${ this.Tag } SELECT "${ this.imapServer.listenFolder }"${ conText }`
        this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
        if ( this.writable )
            return this.push ( this.cmd + '\r\n')
        this.imapServer.destroyAll(null)
    }

    public openBoxV1 ( folder: string, CallBack ) {
		this.newSwitchRet = false
		let UID = 0
        this.doCommandCallback = ( err ) => {
            if ( err ) {
                return CallBack ( err )
            }
            CallBack ( null, this.newSwitchRet, UID )
        }

        this.commandProcess = ( text: string, cmdArray: string[], next, _callback ) => {
            switch ( cmdArray[0] ) {
                case '*': {
                    if ( /^EXISTS$|^UIDNEXT$|UNSEEN/i.test ( cmdArray [2])) {
						const _num = text.split ('UNSEEN ')[1]
						if ( _num ) {
							
							UID = parseInt ( _num.split (']')[0])
						}
                        this.newSwitchRet = true
                        
                    }
                    return _callback ()
                }
                default:
                return _callback ()
            }
        }

        const conText = this.imapServer.condStoreSupport ? ' (CONDSTORE)' : ''
        
        this.Tag = `A${ this.imapServer.TagCount1() }`
        this.cmd = `${ this.Tag } SELECT "${ folder }"${ conText }`
        this.debug ? debugOut ( this.cmd, false, folder || this.imapServer.imapSerialID ) : null
        if ( this.writable )
            return this.push ( this.cmd + '\r\n')
        this.imapServer.destroyAll ( new Error ( 'imapServer un-writeable' ))
    }

    public _logoutWithoutCheck ( CallBack ) {
        //console.trace (`doing _logout typeof CallBack = [${ typeof CallBack }]`)
        if ( !this.isImapUserLoginSuccess ) {
            return CallBack ()
        }

        this.doCommandCallback = ( err, info: string ) => {
            
            return CallBack ( err )
		}
		
        clearTimeout ( this.idleResponsrTime )
        this.commandProcess = ( text: string, cmdArray: string[], next, _callback ) => {
            //console.log (`_logout doing this.commandProcess `)
            this.isImapUserLoginSuccess = false
            return _callback ()
		}
		
        this.Tag = `A${ this.imapServer.TagCount1() }`
		this.cmd = `${ this.Tag } LOGOUT`
		
        this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
        if ( this.writable ) {
			this.appendWaitResponsrTimeOut = setTimeout (() => {
				
				return CallBack ()
			}, 1000 * 30 )

            return this.push ( this.cmd + '\r\n')
        }
        if ( CallBack && typeof CallBack === 'function') {
            return CallBack()
        }
        
    }

    public append ( text: string, subject: string, CallBack ) {
        //console.log (`[${ this.imapServer.imapSerialID }] ImapServerSwitchStream append => [${ text.length }]`)
        if ( typeof subject === 'function' ) {
			CallBack = subject
			subject = null
		}

        this.doCommandCallback = ( err, info: string ) => {

			if ( err && /TRYCREATE|Mailbox/i.test ( err.message )) {
				return this.createBox ( false, this.imapServer.writeFolder, err1 => {
					if ( err1 ) {
						return CallBack ( err1 )
					}
					return this.append ( text, subject, CallBack )
				})
			}
            
            console.log (`[${ this.imapServer.listenFolder || this.imapServer.imapSerialID }] append doCommandCallback `, err )
            return CallBack ( err, info )
            
		}
		

        let out = `Date: ${ new Date().toUTCString()}\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment\r\nMessage-ID:<${ Uuid.v4() }@>${ this.imapServer.domainName }\r\n${ subject ? 'Subject: '+ subject + '\r\n' : '' }Content-Transfer-Encoding: base64\r\nMIME-Version: 1.0\r\n\r\n${ text }`

        this.commandProcess = ( text1: string, cmdArray: string[], next, _callback ) => {
            switch ( cmdArray[0] ) {
                case '*':
                case '+': {

                    if ( ! this.imapServer.literalPlus && out.length && ! this.callback ) {
                        console.log (`====> append ! this.imapServer.literalPlus && out.length && ! this.callback = [${ ! this.imapServer.literalPlus && out.length && ! this.callback }]`)
                        this.debug ? debugOut ( out, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
                        this.callback = true
                        next ( null, out + '\r\n' )
                    }
                    return _callback ()
                }
                default:
                return _callback ()
            }
        }

        this.Tag = `A${ this.imapServer.TagCount1() }`
        this.cmd = `APPEND "${ this.imapServer.writeFolder }" {${ out.length }${ this.imapServer.literalPlus ? '+' : ''}}`
        this.cmd = `${ this.Tag } ${ this.cmd }`
        const time = out.length + 30000
        this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
        if ( !this.writable ) {
            //console.log (`[${ this.imapServer.imapSerialID }] ImapServerSwitchStream append !this.writable doing imapServer.socket.end ()`)
            return this.imapServer.socket.end ()
        }
            
        this.push ( this.cmd + '\r\n' )
        
        this.appendWaitResponsrTimeOut = setTimeout (() => {
            return this.doCommandCallback ( new Error ( `IMAP append TIMEOUT` ))
		}, time )
		
        //console.log (`*************************************  append time = [${ time }] `)
        if ( this.imapServer.literalPlus ) {
            this.debug ? debugOut ( out, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
            this.push ( out + '\r\n' )
        }
            
    }

    public appendStreamV4 ( Base64Data: string = '', subject: string = null, folderName: string, CallBack ) {

        if ( !Base64Data ) {
            Base64Data = ''
        }

		console.log (`appendStreamV4 Base64Data = [${ Base64Data }]`)

        this.doCommandCallback = ( err, response: string ) => {
            //this.debug ? saveLog (`appendStreamV2 doing this.doCommandCallback`) : null
            clearTimeout ( this.appendWaitResponsrTimeOut )

            if ( err ) {
                if ( /TRYCREATE/i.test( err.message )) {
                    return this.createBox ( false, this.imapServer.writeFolder, err1 => {
                        if ( err1 ) {
                            return CallBack ( err1 )
                        }
                        return this.appendStreamV4 ( Base64Data, subject, folderName, CallBack )
                    })
                }
                return CallBack ( err )
            }
			let code = response && response.length ? response.split('[')[1]: null
			if ( code ) {
				
				code = code.split (' ')[2]
				//console.log ( `this.doCommandCallback\n\n code = ${ code } code.length = ${ code.length }\n\n` )
				if ( code ) {
					return CallBack( null, parseInt ( code ))
				}
			}
            CallBack ()
        }


        const out = `Date: ${ new Date().toUTCString()}\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment\r\nMessage-ID:<${ Uuid.v4() }@>${ this.imapServer.domainName }\r\n${ subject ? 'Subject: '+ subject + '\r\n' : '' }Content-Transfer-Encoding: base64\r\nMIME-Version: 1.0\r\n\r\n`
        
		this.commandProcess = ( text1: string, cmdArray: string[], next, _callback ) => {
			switch ( cmdArray[0] ) {
				case '*':
				case '+': {
					if ( ! this.imapServer.literalPlus && out.length && ! this.callback ) {
						
						this.callback = true
						
						//this.debug ? debugOut ( out, false, this.imapServer.IMapConnect.imapUserName ) : null
						next ( null, out + Base64Data + '\r\n' )
					}
					return _callback ()
				}
				default:
				return _callback ()
			}
		}

		const _length = out.length + Base64Data.length
		this.Tag = `A${ this.imapServer.TagCount1() }`
		this.cmd = `APPEND "${ folderName }" {${ _length }${ this.imapServer.literalPlus ? '+' : ''}}`
		this.cmd = `${ this.Tag } ${ this.cmd }`
		const _time = _length + 1000 * 60
		this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
		if ( !this.writable ) {
			return this.doCommandCallback ( new Error ('! imap.writable '))
		}
			
		this.push ( this.cmd + '\r\n' )

		this.appendWaitResponsrTimeOut = setTimeout (() => {
			
			return this.doCommandCallback( new Error ('appendStreamV3 mail serrver write timeout!'))
				
		}, _time )

		//console.log (`*************************************  append time = [${ time }] `)
		if ( this.imapServer.literalPlus ) {
			
			
			//this.debug ? debugOut ( out + Base64Data + '\r\n', false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
			this.push ( out )
			this.push ( Base64Data + '\r\n' )
			
		}
        
        
        
        
    }

    public seachUnseen ( callabck ) {
        let newSwitchRet = null
        let moreNew = false
        this.doCommandCallback = ( err ) => {
            if ( err )
                return callabck ( err )
            return callabck ( null, newSwitchRet, moreNew )
        }
        this.commandProcess = ( text: string, cmdArray: string[], next, _callback ) => {
            switch ( cmdArray[0] ) {
                case '*': {
                    if ( /^SEARCH$/i.test ( cmdArray [1] ) ) {
                        const uu1 = cmdArray[2] && cmdArray[2].length > 0 ? parseInt ( cmdArray[2] ) : 0
                        if ( cmdArray.length > 2 && uu1 ) {
                            if ( ! cmdArray [ cmdArray.length - 1 ].length )
                                cmdArray.pop ()
                            
                            const uu = cmdArray.slice ( 2 ).join ( ',' )
                            if ( /\,/.test ( uu [ uu.length - 1 ]) )
                                uu.substr ( 0, uu.length - 1 )
                            
                            newSwitchRet =  uu
                            moreNew = cmdArray.length > 3
                        }
                        return _callback ()
                    }
                    if ( /^EXISTS$/i.test ( cmdArray [2])) {
                        this.imapServer.emit ('SEARCH_HAVE_EXISTS')
                    }
                    return _callback ()
                }


                default:
                return _callback ()
            }
        }

        this.Tag = `A${ this.imapServer.TagCount1() }`
        this.cmd = `${ this.Tag } UID SEARCH ALL`
        this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
        if ( this.writable ) {
			return this.push ( this.cmd + '\r\n')
		}
            
        return this.imapServer.destroyAll ( null )
    }

    public fetch ( fetchNum, callback ) {

        this.doCommandCallback = ( err ) => {
            console.log (`ImapServerSwitchStream doing doCommandCallback [${ this.newSwitchRet }], err [${ err }]`)
            return callback ( err, this.newSwitchRet )
        }
        
        this.newSwitchRet = false

        this.commandProcess = ( text1: string, cmdArray: string[], next, _callback ) => {
            
            switch ( cmdArray[0] ) {
                case '*': {
                    if ( /^FETCH$/i.test ( cmdArray [ 2 ] )) {
                        
                        if ( /\{\d+\}/.test ( text1 )) {
							
							this.imapServer.fetching = parseInt ( text1.split('{')[1].split('}')[0] )
							
                        } 
						
						//this.debug ? console.log ( `${ text1 } doing length [${ this.imapServer.fetching }]` ) : null
						
                    }
                    if ( /^RECENT$/i.test ( cmdArray[2]) && parseInt ( cmdArray[1]) > 0 ) {
                        this.newSwitchRet = true
                    }
                    return _callback ()
                }
                default:
                return _callback ()
            }
		}
		
        //console.log (`ImapServerSwitchStream doing UID FETCH `)
        this.cmd = `UID FETCH ${ fetchNum } ${ this.imapServer.fetchAddCom }`
        this.Tag = `A${ this.imapServer.TagCount1() }`
        this.cmd = `${ this.Tag } ${ this.cmd }`
        this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
        
        this.appendWaitResponsrTimeOut = setTimeout (() => {
            //this.imapServer.emit ( 'error', new Error (`${ this.cmd } timeout!`))
            return this.doCommandCallback ( new Error (`${ this.cmd } timeout!`))
        }, this.imapServer.fetching + 1000 * 120 )

        if ( this.writable ) {
			
            return this.push ( this.cmd + '\r\n' )
        }
            
        return this.imapServer.destroyAll ( null )
    }

    private deleteBox ( CallBack ) {
        this.doCommandCallback = CallBack
        this.commandProcess = ( text1: string, cmdArray: string[], next, _callback ) => {
            return _callback ()
        }
        this.cmd = `DELETE "${ this.imapServer.listenFolder }"`
        this.Tag = `A${ this.imapServer.TagCount1() }`
        this.cmd = `${ this.Tag } ${ this.cmd }`
        this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
        if ( this.writable )
            return this.push ( this.cmd + '\r\n' )
        return this.imapServer.destroyAll ( null )
    }

    public deleteAMailBox ( boxName: string, CallBack ) {
        
        this.doCommandCallback = err => {

            return CallBack ( err )
        }

        this.commandProcess = ( text1: string, cmdArray: string[], next, _callback ) => {
            return _callback ()
        }
        this.cmd = `DELETE "${ boxName }"`
        this.Tag = `A${ this.imapServer.TagCount1() }`
        this.cmd = `${ this.Tag } ${ this.cmd }`
        this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
        if ( this.writable )
            return this.push ( this.cmd + '\r\n' )
        return this.imapServer.destroyAll ( null )
    }

    public flagsDeleted ( num: string, CallBack ) {
        this.doCommandCallback = err => {
            //saveLog ( `ImapServerSwitchStream this.flagsDeleted [${ this.imapServer.listenFolder }] doing flagsDeleted success! typeof CallBack = [${ typeof CallBack }]`)
            return CallBack ( err )
        }
        this.commandProcess = ( text1: string, cmdArray: string[], next, _callback ) => {
			switch ( cmdArray[0] ) {
                case '*': {
                    if ( /^FETCH$/i.test ( cmdArray [ 2 ] )) {
                        
                        if ( /\{\d+\}/.test ( text1 )) {
							
							this.imapServer.fetching = parseInt ( text1.split('{')[1].split('}')[0] )
							
                        } 
						
						this.debug ? console.log ( `${ text1 } doing length [${ this.imapServer.fetching }]` ) : null
						
                    }
                    if ( /^EXISTS$/i.test ( cmdArray[2]) && parseInt ( cmdArray[1]) > 0 ) {
                        this.newSwitchRet = true
                    }
                    return _callback ()
                }
                default:
                return _callback ()
            
			}
		}
        this.cmd = `UID STORE ${ num } FLAGS.SILENT (\\Deleted)`
        this.Tag = `A${ this.imapServer.TagCount1() }`
        this.cmd = `${ this.Tag } ${ this.cmd }`
        this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
        if ( this.writable ) {
			return this.push ( this.cmd + '\r\n' )
		}
            
        return this.imapServer.destroyAll ( null )
    }

    public expunge ( CallBack ) {

        
        this.doCommandCallback = err => {
            
            return CallBack ( err, this.newSwitchRet )
        }
        this.commandProcess = ( text: string, cmdArray: string[], next , _callback ) => {
            switch ( cmdArray[0] ) {
                case '*': {
                    
                    if ( /^RECENT$|^EXPUNGE$|^EXISTS$/i.test ( cmdArray[2]) && parseInt (cmdArray[1]) > 0 ) {
						//console.log (`\n\nexpunge this.newSwitchRet = true\n\n`)
                        this.newSwitchRet = true
                    }
                    return _callback ()
                }
                default:
                return _callback ()
            }
        }
        
        this.Tag = `A${ this.imapServer.TagCount1() }`
        this.cmd = `${ this.Tag } EXPUNGE`
        this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
        if ( this.writable ) {
			return this.push ( this.cmd + '\r\n')
		}
            
        return this.imapServer.destroyAll ( null )
    }

    public listAllMailBox ( CallBack ) {
        let boxes = []
        this.doCommandCallback = ( err ) => {
            if ( err )
                return CallBack ( err )
            return CallBack ( null, boxes )
        }
        this.commandProcess = ( text: string, cmdArray: string[], next, _callback ) => {
            switch ( cmdArray[0] ) {
                case '*': {
                    debug ? saveLog ( `IMAP listAllMailBox this.commandProcess text = [${ text }]` ) : null
                    if ( /^LIST/i.test ( cmdArray [1] ) ) {
                        boxes.push ( cmdArray[2] + ',' + cmdArray[4] )
                    } 
                    return _callback ()
                }
                default:
                return _callback ()
            }
        }

        this.Tag = `A${ this.imapServer.TagCount1() }`
        this.cmd = `${ this.Tag } LIST "" "*"`
        this.debug ? debugOut ( this.cmd, false, this.imapServer.listenFolder || this.imapServer.imapSerialID ) : null
        if ( this.writable )
            return this.push ( this.cmd + '\r\n')
        return this.imapServer.destroyAll ( null )
    }
}

const connectTimeOut = 10 * 1000
export class qtGateImap extends Event.EventEmitter {
    public socket: Tls.TLSSocket
    public imapStream: ImapServerSwitchStream = new ImapServerSwitchStream ( this, this.deleteBoxWhenEnd, this.debug )
    public newSwitchRet = null
    public newSwitchError = null
    public fetching = null
    private tagcount = 0
    public domainName = this.IMapConnect.imapUserName.split ('@')[1]
    public serverSupportTag = null
    public idleSupport = null
    public condStoreSupport = null
    public literalPlus = null
    public fetchAddCom = ''
    public imapEnd = false
    
    public imapSerialID = Crypto.createHash ( 'md5' ).update ( JSON.stringify( this.IMapConnect) ).digest ('hex').toUpperCase()
    
    
    private port: number = typeof this.IMapConnect.imapPortNumber === 'object' ? this.IMapConnect.imapPortNumber[0]: this.IMapConnect.imapPortNumber
    public TagCount1 () {
		return ++ this.tagcount
    }

    private connect () {
        const _connect = () => {
            
            clearTimeout ( timeout )
			console.log ( Util.inspect ({ ConnectTo_Imap_Server: true ,servername: this.IMapConnect.imapServer, IPaddress:  this.socket.remoteAddress }, false, 2, true ) )
            this.socket.setKeepAlive ( true )
            
            this.socket.pipe ( this.imapStream ).pipe ( this.socket ).once ( 'error', err => {
				return this.destroyAll ( err )
			}).once ( 'end', () => {
				return this.destroyAll ( null )
			})
        }

        //console.log ( `qtGateImap connect mail server [${ this.IMapConnect.imapServer }: ${ this.port }] setTimeout [${ connectTimeOut /1000 }] !`)

        const timeout = setTimeout (() => {
            return this.socket.destroy ( new Error ('connect time out!'))
        }, connectTimeOut )

        
        this.socket  = Tls.connect ({ host: this.IMapConnect.imapServer, port: this.port }, _connect )
        

        return this.socket.on ( 'error', err => {
            return this.destroyAll ( err )
        })


    }

    constructor ( public IMapConnect: imapConnect, public listenFolder: string, public deleteBoxWhenEnd: boolean, public writeFolder: string, private debug: boolean, public newMail: ( mail ) => void, private skipOldMail = true ) {
        super ()
        this.connect ()
        this.once ( `error`, err => {
            debug ? saveLog ( `[${ this.imapSerialID }] this.on error ${ err && err.message ? err.message : null }`) : null
            this.imapEnd = true
            return this.destroyAll ( err )
            
        })
        
        
    }

    public destroyAll ( err: Error ) {
		//console.trace (`class qtGateImap on destroyAll`, err )
		this.imapEnd = true

		if ( this.socket && typeof this.socket.end === 'function' ) {
            this.socket.end ()
            
		}
		
        return this.emit ( 'end', err )
        
    }

    public logout ( CallBack = null ) {
        console.log (`IMAP logout`)
		const _end = () => {
			if ( typeof CallBack === 'function' ) {
				return CallBack ()
			}
		}

        if ( this.imapEnd ) {
            console.log (`this.imapEnd`)
            return _end ()
        }
        this.imapEnd = true
        console.log (`this.imapStream.loginoutWithCheck`)
        return this.imapStream.loginoutWithCheck (() => {
            
            if ( this.socket && typeof this.socket.end === 'function' ) {
                
                this.socket.end()
            }
            
			this.emit ( 'end' )
			return _end ()
        })
    }

}


export const seneMessageToFolder = ( IMapConnect: imapConnect, writeFolder: string, message: string, subject: string, createFolder: boolean, CallBack ) => {
	const wImap = new qtGateImap ( IMapConnect, null, false, writeFolder, debug, null )
	let _callback = false 
	//console.log ( `seneMessageToFolder !!! ${ subject }`)
	wImap.once ( 'error', err => {
		wImap.destroyAll ( err )
		if ( !_callback ) {
			CallBack ( err )
			return _callback = true 
		}
	})

	wImap.once ( 'ready', () => {
		Async.series ([
			next => {
                if ( !createFolder ) {
                    return next ()
                }
                return wImap.imapStream.createBox ( false, writeFolder, next )
            },
			next => wImap.imapStream.appendStreamV4 ( message, subject, writeFolder, next ),
			next => wImap.imapStream._logoutWithoutCheck ( next )
		], err => {
			_callback = true
			if ( err ) {
				wImap.destroyAll ( err )
				
			}
			return CallBack ( err )
		})
	})

}

        
export class qtGateImapRead extends qtGateImap {

    private openBox = false

    constructor ( IMapConnect: imapConnect, listenFolder: string, deleteBoxWhenEnd: boolean, newMail: ( mail ) => void, skipOldMail = false ) {

        super ( IMapConnect, listenFolder, deleteBoxWhenEnd, null, debug, newMail, skipOldMail )
        this.once ( 'ready', () => {
            this.openBox = true
        })
    }
    
}

export const getMailAttached = ( email: Buffer ) => {
    
    const attachmentStart = email.indexOf ('\r\n\r\n')
    if ( attachmentStart < 0 ) {
        console.log ( `getMailAttached error! can't faind mail attahced start!\n${ email.toString() }`)
        return ''
    }
    const attachment = email.slice ( attachmentStart + 4 )
   
    return attachment.toString()
}

export const getMailSubject = ( email: Buffer ) => {
	const ret = email.toString().split ('\r\n\r\n')[0].split('\r\n')
	
	const yy = ret.find ( n => {
		return /^subject\: /i.test( n )
	})
	if ( !yy || !yy.length ) {
		debug ? saveLog(`\n\n${ ret } \n`) : null
		return ''
	}
	return yy.split(/^subject\: +/i)[1]
}

export const getMailAttachedBase64 = ( email: Buffer ) => {
    
    const attachmentStart = email.indexOf ('\r\n\r\n')
    if ( attachmentStart < 0 ) {
        console.log ( `getMailAttached error! can't faind mail attahced start!`)
        return null
    }
    const attachment = email.slice ( attachmentStart + 4 )
    return attachment.toString()
}


export const imapAccountTest = ( IMapConnect: imapConnect, CallBack ) => {
    debug ? saveLog ( `start test imap [${ IMapConnect.imapUserName }]`, true ) : null
    let callbackCall = false
    
    const listenFolder = Uuid.v4 ()
    const ramdomText = Crypto.randomBytes ( 20 )
    let timeout: NodeJS.Timer = null

    const doCallBack = ( err?, ret? ) => {
        if ( ! callbackCall ) {
            
            saveLog (`imapAccountTest doing callback err [${ err && err.message ? err.message : `undefine `}] ret [${ ret ? ret : 'undefine'}]`)
            callbackCall = true
            clearTimeout ( timeout )
            return CallBack ( err, ret )
        }
    }

    
    let rImap = new qtGateImapRead ( IMapConnect, listenFolder, debug, mail => {
        rImap.logout ()
    })

    rImap.once ( 'ready', () => {
		rImap.logout ()
    })

    rImap.once ( 'end', err => {
		console.log ( `imapAccountTest on end err = `, err )
        doCallBack ( err )
    })

    rImap.once ( 'error', err => {
        debug ? saveLog ( `rImap.once ( 'error' ) [${ err.message }]`, true ): null
    })


}

export const imapGetMediaFile = ( IMapConnect: imapConnect, fileName: string, CallBack ) => {
    let rImap = new qtGateImapRead ( IMapConnect, fileName, debug, mail => {
        rImap.logout ()
        const retText = getMailAttachedBase64 ( mail )
        return CallBack ( null, retText )
    })
}

const pingPongTimeOut = 1000 * 15


interface mailPool {
    CallBack: () => void
	mail: Buffer
	uuid: string
}

const resetConnectTimeLength = 1000 * 60 * 30

export class imapPeer extends Event.EventEmitter {

    public domainName = this.imapData.imapUserName.split('@')[1]
    private waitingReplyTimeOut: NodeJS.Timer = null
    public pingUuid = null
    private doingDestroy = false
    
    public peerReady = false
    private makeRImap = false
	public needPingTimeOut = null
    
    public pinging = false
    public connected = false
    public rImap_restart = false
    public checkSocketConnectTime = null

    private restart_rImap () {
        
		console.dir ('restart_rImap')
        if ( this.rImap_restart ) {
            return console.log (`already restart_rImap STOP!`)
        }

        this.rImap_restart = true

		if ( typeof this.rImap?.imapStream?.loginoutWithCheck === 'function') {
			return this.rImap.imapStream.loginoutWithCheck (() => {
				if ( typeof this.exit === 'function') {
					this.exit (0)
				}
			})
		}
		if ( typeof this.exit === 'function') {
			this.exit (0)
		}
		
        
    }

    public checklastAccessTime () {
        clearTimeout ( this.checkSocketConnectTime )
		return this.checkSocketConnectTime = setTimeout (() => {
			return this.restart_rImap ()
		}, resetConnectTimeLength )
    }

    private mail ( email: Buffer ) {
        
		//console.log (`imapPeer new mail:\n\n${ email.toString()} this.pingUuid = [${ this.pingUuid  }]`)
        const subject = getMailSubject ( email )
        const attr = getMailAttached ( email )
		console.log ( email.toString () )
        

		/**
		 * 			PING get PONG
		 */
		if ( subject === this.pingUuid ) {
			this.pingUuid = null
			
			this.connected = true
			this.pinging = false
			clearTimeout ( this.waitingReplyTimeOut )

			return this.emit ('CoNETConnected', attr )
		}

		if ( subject ) {

            /**
             * 
             * 
             * 
             */
            

			if ( attr.length < 40 ) {
				console.log (`new attr\n${ attr }\n`)
				const _attr = attr.split (/\r?\n/)[0]

				if ( !this.connected && !this.pinging ) {
					this.Ping ( false )
				}

				if ( subject === _attr ) {
					console.log (`\n\nthis.replyPing [${_attr }]\n\n this.ping.uuid = [${ this.pingUuid }]`)
					
					return this.replyPing ( subject )
				}
				console.log ( `this.pingUuid = [${ this.pingUuid  }] subject [${ subject }]`)
				return console.log (`new attr\n${ _attr }\n _attr [${ Buffer.from (_attr).toString ('hex') }] subject [${ Buffer.from ( subject ).toString ('hex') }]]!== attr 【${ JSON.stringify ( _attr )}】`)
			}
			
			
			
            

			/**
			 * 			ignore old mail
			 */
			if ( !this.connected ) {
				return 
			}

            return this.newMail ( attr, subject )

		}		
        console.log (`get mail have not subject\n\n`, email.toString() )

    }


    private replyPing ( uuid ) {
		console.log (`\n\nreplyPing = [${ uuid }]\n\n`)
        return this.AppendWImap1 ( uuid, uuid, err => {
            if ( err ) {
                debug ? saveLog (`reply Ping ERROR! [${ err.message ? err.message : null }]`): null 
            }
        })
        
    }

    private AppendWImap1 ( mail: string, uuid: string, CallBack ) {
        
        return seneMessageToFolder ( this.imapData, this.writeBox, mail, uuid, false, CallBack )
        
    }

    private setTimeOutOfPing ( sendMail: boolean ) {
        console.trace (`setTimeOutOfPing [${ this.pingUuid }]`)
        clearTimeout ( this.waitingReplyTimeOut )
        clearTimeout ( this.needPingTimeOut )
		debug ? saveLog ( `Make Time Out for a Ping, ping ID = [${ this.pingUuid }]`, true ): null
		
        return this.waitingReplyTimeOut = setTimeout (() => {
            debug ? saveLog ( `ON setTimeOutOfPing this.emit ( 'pingTimeOut' ) pingID = [${ this.pingUuid }] `, true ): null
			this.pingUuid = null
			this.connected = false
			this.pinging = false
            return this.emit ( 'pingTimeOut' )
        }, sendMail ? pingPongTimeOut * 8 : pingPongTimeOut )
    }
    
    public Ping ( sendMail: boolean ) {
        
        if ( this.pinging ) {
            return console.trace ('Ping stopd! pinging = true !')
        }
        this.pinging = true
		
		this.emit ( 'ping' )

        this.pingUuid = Uuid.v4 ()
        debug ? saveLog ( `doing ping test! this.pingUuid = [${ this.pingUuid }], sendMail = [${ sendMail }]`, ): null
        
        return this.AppendWImap1 ( null, this.pingUuid, err => {
           
            if ( err ) {
				this.pinging = false
                this.pingUuid = null
                console.dir ( `PING this.AppendWImap1 Error [${ err.message }]`)
                return this.Ping ( sendMail )
            }
            return this.setTimeOutOfPing ( sendMail )
        })
    }

    public rImap: qtGateImapRead = null

    public newReadImap() {

        if ( this.makeRImap || this.rImap && this.rImap.imapStream && this.rImap.imapStream.readable ) {
            return debug ? saveLog (`newReadImap have rImap.imapStream.readable = true, stop!`, true ): null
        }
        this.makeRImap = true
        //saveLog ( `=====> newReadImap!`, true )


        this.rImap = new qtGateImapRead ( this.imapData, this.listenBox, debug, email => {
            this.mail ( email )
        }, true )

        this.rImap.once ( 'ready', () => {
			this.emit ( 'ready' )
            this.makeRImap = this.rImap_restart = false
            //debug ? saveLog ( `this.rImap.once on ready `): null
			this.Ping ( false )
			this.checklastAccessTime ()
        })

        this.rImap.on ( 'error', err => {
            this.makeRImap = false
            debug ? saveLog ( `rImap on Error [${ err.message }]`, true ): null
            if ( err && err.message && /auth|login|log in|Too many simultaneous|UNAVAILABLE/i.test ( err.message )) {
                return this.destroy (1)
            }
            if ( this.rImap && this.rImap.destroyAll && typeof this.rImap.destroyAll === 'function') {
                return this.rImap.destroyAll (null)
            }
            

        })

        this.rImap.on ( 'end', err => {
            this.rImap.removeAllListeners ()
            this.rImap = null
            this.makeRImap = false
			clearTimeout ( this.waitingReplyTimeOut )
            if ( this.rImap_restart ) {
                console.dir (`rImap.on ( 'end' ) this.rImap_restart = TRUE`, err )
            }


            if ( typeof this.exit === 'function') {
                debug ? saveLog (`imapPeer rImap on END!`): null

                this.exit ( err )
                return this.exit = null
            }
            debug ? saveLog (`imapPeer rImap on END! but this.exit have not a function `): null
            
            
        })
    }

    constructor ( public imapData: imapConnect, private listenBox: string, private writeBox: string, public newMail, public exit: ( err?: number ) => void ) {
        super ()
        debug ? saveLog ( `doing peer account [${ imapData.imapUserName }] listen with[${ listenBox }], write with [${ writeBox }] `): null
		console.dir ( `newMail = ${typeof newMail}` )
        this.newReadImap ()
		
    }

    public destroy ( err?: number ) {
        
        clearTimeout ( this.waitingReplyTimeOut )
        clearTimeout ( this.needPingTimeOut )
        clearTimeout ( this.checkSocketConnectTime )
        console.log (`destroy IMAP!`)
        console.trace ()
        if ( this.doingDestroy ) {
            return console.log (`destroy but this.doingDestroy = ture`)
        }
            
        this.doingDestroy = true
        this.peerReady = false
       
        if ( this.rImap ) {
            return this.rImap.imapStream.loginoutWithCheck (() => {
				if ( typeof this.exit === 'function' ) {
					this.exit ( err )
					this.exit = null
				}
				
			})
        }
        
        if  ( this.exit && typeof this.exit === 'function' ) {
            this.exit ( err )
            this.exit = null
        }
	}
	
	public sendDataToANewUuidFolder ( data: string, writeBox: string, subject: string, CallBack ) {
		
		return seneMessageToFolder ( this.imapData, writeBox, data, subject, !this.connected, CallBack )
	}

}

