import { Component, Input, OnInit } from '@angular/core';
import { Config, PopoverController } from '@ionic/angular';

import { AlertService } from '@pwa/service/alert.service';
import { ContextMenuBreadcrumbComponent } from './../context-menu-breadcrumb/context-menu-breadcrumb.component';
import { ContextMenuDirectoryComponent } from './../context-menu-directory/context-menu-directory.component';
import { FileEntry } from '@common/bridge/Vfs';
import { StorageCard } from '@pwa/model/StorageCard';
import { VfsService } from '@pwa/service/vfs.service';

function entrySortFunction(e1: FileEntry, e2: FileEntry): number {
    if (e1.isDirectory && !e2.isDirectory) return -1;
    if (!e1.isDirectory && e2.isDirectory) return 1;

    return e1.name.localeCompare(e2.name);
}

let BREADCRUMB_TRIGGER_INDEX = 0;

@Component({
    selector: 'app-subpage-directory',
    templateUrl: './subpage-directory.component.html',
    styleUrls: ['./subpage-directory.component.scss'],
})
export class SubpageDirectoryComponent implements OnInit {
    constructor(
        private vfsService: VfsService,
        private popoverController: PopoverController,
        private config: Config,
        private alertService: AlertService
    ) {
        this.breadcrumbTriggerId = `breadcrumb-trigger-${BREADCRUMB_TRIGGER_INDEX++}`;
    }

    get title(): string {
        switch (this.path) {
            case '/':
                return this.card?.name ?? '';

            case undefined:
                return '';

            default: {
                const splitPath = this.vfsService.splitPath(this.path);

                return splitPath[splitPath.length - 1] ?? '';
            }
        }
    }

    get showBreadcrumb(): boolean {
        return !!this.path && this.path !== '/';
    }

    ngOnInit(): void {
        this.updateEntries();
    }

    trackEntryBy(index: number, entry: FileEntry) {
        return entry.name;
    }

    onSelect(entry: FileEntry): void {
        if (entry.isDirectory) this.onNavigate(entry.path);
    }

    onEditEntry(entry: FileEntry): void {
        void this.alertService.message('Not implemented', `Edit ${entry.name}: not implemented.`);
    }

    onSaveEntry(entry: FileEntry): void {
        void this.alertService.message('Not implemented', `Save ${entry.name}: not implemented.`);
    }

    onCopyEntry(entry: FileEntry): void {
        void this.alertService.message('Not implemented', `Copy ${entry.name}: not implemented.`);
    }

    onCutEntry(entry: FileEntry): void {
        void this.alertService.message('Not implemented', `Cut ${entry.name}: not implemented.`);
    }

    onDeleteEntry(entry: FileEntry): void {
        void this.alertService.message('Not implemented', `Delete ${entry.name}: not implemented.`);
    }

    onStartSelection(): void {
        void this.alertService.message('Not implemented', 'Start selection: not implemented.');
    }

    onAddFiles(): void {
        void this.alertService.message('Not implemented', 'Add files: not implemented.');
    }

    onCreateDirectory(): void {
        void this.alertService.message('Not implemented', 'Create directory: not implemented.');
    }

    onExtractZipfile(): void {
        void this.alertService.message('Not implemented', 'Extract zipfile: not implemented.');
    }

    onPaste(): void {
        void this.alertService.message('Not implemented', 'Paste: not implemented.');
    }

    onHelp(): void {
        void this.alertService.message('Not implemented', 'Help: not implemented.');
    }

    async openBreadcrumbMenu(e: MouseEvent): Promise<void> {
        if (!this.card || !this.path || this.path === '/') return;

        const entries = [
            ...[...this.vfsService.splitPath(this.path).reverse().slice(1), this.card.name],
            'Memory cards',
        ];

        const popover = await this.popoverController.create({
            component: ContextMenuBreadcrumbComponent,
            event: e,
            componentProps: {
                entries,
                onSelect: (index: number) => this.onNavigateBreadcrumb(entries.length - 1 - index),
            },
            dismissOnSelect: true,
            arrow: false,
            side: 'bottom',
            alignment: this.config.get('mode') === 'ios' ? 'center' : 'start',
            trigger: this.breadcrumbTriggerId,
        });

        void popover.present();
    }

    async openContextMenu(e: MouseEvent): Promise<void> {
        const popover = await this.popoverController.create({
            component: ContextMenuDirectoryComponent,
            componentProps: {
                onStartSelection: this.onStartSelection.bind(this),
                onAddFiles: this.onAddFiles.bind(this),
                onCreateDirectry: this.onCreateDirectory.bind(this),
                onExtractZipfile: this.onExtractZipfile.bind(this),
                onPaste: this.onPaste.bind(this),
                onHelp: this.onHelp.bind(this),
            },
            event: e,
            dismissOnSelect: true,
            arrow: false,
        });

        void popover.present();
    }

    private updateEntries(): void {
        if (this.path === undefined) {
            this.entries = [];
            return;
        }

        void this.vfsService
            .readdir(this.path)
            .then((entries) => (this.entries = entries ? [...entries].sort(entrySortFunction) : []));
    }

    @Input()
    card: StorageCard | undefined;

    @Input()
    path: string | undefined;

    @Input()
    onNavigate: (path: string) => void = () => undefined;

    @Input()
    onNavigateBreadcrumb: (index: number) => void = () => undefined;

    entries: Array<FileEntry> | undefined;

    lastEntryTouched: string | undefined = undefined;

    readonly breadcrumbTriggerId: string;
}
