/*******************************************************************************

    uBlock Ultimate - a comprehensive, efficient content blocker
    Copyright (C) 2015-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

import { broadcast, broadcastToAll } from './broadcast.js';
import µb from './background.js';

/******************************************************************************/

interface LoggerDetails {
    tstamp?: number;
    [key: string]: unknown;
}

interface DeferredTimer {
    on: (delay: number) => void;
}

let buffer: string[] | null = null;
let lastReadTime = 0;
let writePtr = 0;

const logBufferObsoleteAfter = 30 * 1000;

let janitorTimer: DeferredTimer | null = null;

const initJanitor = (): DeferredTimer => {
    if (janitorTimer === null) {
        janitorTimer = vAPI.defer.create(( ) => {
            if ( buffer === null ) { return; }
            if ( lastReadTime >= (Date.now() - logBufferObsoleteAfter) ) {
                return initJanitor().on(logBufferObsoleteAfter);
            }
            logger.enabled = false;
            buffer = null;
            writePtr = 0;
            logger.ownerId = undefined;
            broadcastToAll({ what: 'loggerDisabled' });
        });
    }
    return janitorTimer;
};

const boxEntry = (details: LoggerDetails): string => {
    details.tstamp = Date.now() / 1000 | 0;
    return JSON.stringify(details);
};

const pushOne = (box: string): void => {
    if ( writePtr !== 0 && box === buffer[writePtr-1] ) { return; }
    if ( writePtr === buffer.length ) {
        buffer.push(box);
    } else {
        buffer[writePtr] = box;
    }
    writePtr += 1;
};

const logger = {
    enabled: false,
    ownerId: undefined as number | undefined,
    writeOne(details: LoggerDetails): void {
        if ( buffer === null ) { return; }
        pushOne(boxEntry(details));
    },
    readAll(ownerId: number): string[] {
        this.ownerId = ownerId;
        if ( buffer === null ) {
            this.enabled = true;
            buffer = [];
            initJanitor().on(logBufferObsoleteAfter);
            broadcast({ what: 'loggerEnabled' });
        }
        const out = buffer.slice(0, writePtr);
        buffer.fill('', 0, writePtr);
        writePtr = 0;
        lastReadTime = Date.now();
        return out;
    },
};

/******************************************************************************/

export default logger;

/******************************************************************************/
