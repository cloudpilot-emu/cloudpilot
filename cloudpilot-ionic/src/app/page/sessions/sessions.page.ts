import { FileDescriptor, FileService } from './../../service/file.service';

import { AlertController } from '@ionic/angular';
import { AlertService } from './../../service/alert.service';
import { Component } from '@angular/core';
import { EmulationService } from './../../service/emulation.service';
import { EmulationStateService } from './../../service/emulation-state.service';
import { Router } from '@angular/router';
import { Session } from 'src/app/model/Session';
import { SessionService } from 'src/app/service/session.service';
import { deserializeSessionImage } from 'src/app/helper/sessionFile';

@Component({
    selector: 'app-sessions',
    templateUrl: './sessions.page.html',
    styleUrls: ['./sessions.page.scss'],
})
export class SessionsPage {
    constructor(
        public sessionService: SessionService,
        private fileService: FileService,
        private alertController: AlertController,
        private alertService: AlertService,
        public emulationService: EmulationService,
        public emulationState: EmulationStateService,
        private router: Router
    ) {}

    get sessions(): Array<Session> {
        return this.sessionService.getSessions().sort((a, b) => a.name.localeCompare(b.name));
    }

    async deleteSession(session: Session): Promise<void> {
        const alert = await this.alertController.create({
            header: 'Warning',
            message: `Deleting the session '${session.name}' will remove all associated data. This cannot be undone. Are you sure you want to continue?`,
            buttons: [
                { text: 'Cancel', role: 'cancel' },
                { text: 'Delete', handler: () => this.sessionService.deleteSession(session) },
            ],
        });

        await alert.present();
    }

    async editSession(session: Session): Promise<void> {
        const newName = await this.queryName(session.name);

        if (newName !== undefined) {
            this.sessionService.updateSession({ ...session, name: newName });
        }
    }

    loadFile(): void {
        this.fileService.openFile(this.processFile.bind(this));
    }

    saveSession(session: Session): void {
        this.fileService.saveSession(session);
    }

    async launchSession(session: Session) {
        this.currentSessionOverride = session.id;

        await this.emulationService.switchSession(session.id);

        this.currentSessionOverride = undefined;

        this.router.navigateByUrl('/tab/emulation');
    }

    get currentSessionId(): number | undefined {
        return this.currentSessionOverride ?? this.emulationState.getCurrentSession()?.id;
    }

    private async processFile(file: FileDescriptor): Promise<void> {
        if (!/\.(img|rom|bin)$/i.test(file.name)) {
            this.alertService.errorMessage('Unsupported file suffix. Supported suffixes are .bin, .img and .rom.');

            return;
        }

        const sessionImage = deserializeSessionImage(file.content);

        if (sessionImage) {
            const name = await this.queryName(this.disambiguateSessionName(sessionImage.metadata?.name ?? file.name));

            if (name !== undefined) this.sessionService.addSessionFromImage(sessionImage, name);
        } else {
            const romInfo = (await this.emulationService.cloudpilot).getRomInfo(file.content);

            if (!romInfo) {
                this.alertService.errorMessage(`Not a valid session file or ROM image.`);
                return;
            }

            if (romInfo.supportedDevices.length === 0) {
                this.alertService.errorMessage(`No supported device for this ROM.`);
                return;
            }

            const name = await this.queryName(this.disambiguateSessionName(file.name));

            if (name !== undefined) {
                this.sessionService.addSessionFromRom(file.content, name, romInfo.supportedDevices[0]);
            }
        }
    }

    private queryName(current?: string): Promise<string | undefined> {
        return new Promise(async (resolve) => {
            const alert = await this.alertController.create({
                header: 'Session Name',
                backdropDismiss: false,
                inputs: [
                    {
                        type: 'textarea',
                        name: 'name',
                        placeholder: 'Session name',
                        value: current,
                        label: 'Name',
                    },
                ],
                buttons: [
                    { text: 'Cancel', role: 'cancel', handler: () => resolve(undefined) },
                    {
                        text: 'Continue',
                        handler: (data) => resolve(data.name),
                    },
                ],
            });

            alert.present();
        });
    }

    private disambiguateSessionName(originalName: string) {
        const sessions = this.sessionService.getSessions();
        let name = originalName;

        let i = 1;
        while (sessions.some((s) => s.name === name)) {
            name = `${originalName} (${i++})`;
        }

        return name;
    }

    private currentSessionOverride: number | undefined;
}
