import * as vscode from 'vscode';
import * as pol from './polarion';
import { PolarionStatus } from "./status";
import { PolarionOutlinesProvider } from './polarionoutline';
import * as utils from './utils';
import * as editor from './editor';


export async function activate(context: vscode.ExtensionContext) {
  // check the current settings
  utils.checkSettings();

  // status bar
  let polarionStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  polarionStatusBar.tooltip = "Restart polarion";
  polarionStatusBar.command = "vscode-polarion.restart";

  let polarionStatus = new PolarionStatus(polarionStatusBar);
  polarionStatus.update(pol.polarion);

  // output channel for logging
  let outputChannel = vscode.window.createOutputChannel("Polarion");
  pol.createPolarion(outputChannel).finally(() => { polarionStatus.update(pol.polarion); });


  // commands
  vscode.commands.registerCommand('vscode-polarion.clearCache', () => pol?.polarion.clearCache());
  vscode.commands.registerCommand('vscode-polarion.openPolarion', () => editor.handleOpenPolarion());
  vscode.commands.registerCommand('vscode-polarion.restart', () => { pol.createPolarion(outputChannel).finally(() => { polarionStatus.update(pol.polarion); }); });
  vscode.commands.registerCommand('vscode-polarion.getWorkItemTitle', (workItem: string) => {
    if (pol?.polarion.initialized === true) {
      return pol.polarion.getTitleFromWorkItem(workItem);
    }
    return undefined;
  });

  // Register the hover provider
  const hoverProvider = vscode.languages.registerHoverProvider(
    { scheme: 'file' }, // Apply to all file types
    new editor.PolarionHoverProvider()
  );
  context.subscriptions.push(hoverProvider);

  //outline provider 
  let outlineProvider = new PolarionOutlinesProvider(vscode.workspace.workspaceFolders);
  vscode.window.registerTreeDataProvider('polarionOutline', outlineProvider);

  // document save and change
  vscode.workspace.onWillSaveTextDocument(async event => {
    const openEditor = vscode.window.visibleTextEditors.filter(
      editor => editor.document.uri === event.document.uri
    )[0];
    utils.documentChanged(openEditor, outlineProvider, polarionStatus);
  });
  vscode.window.onDidChangeActiveTextEditor(async event => { utils.documentChanged(event, outlineProvider, polarionStatus); });

  // configuration change
  vscode.workspace.onDidChangeConfiguration(event => {
    let configChange = event.affectsConfiguration('Polarion');

    if (configChange) {
      utils.checkSettings();

      pol.createPolarion(outputChannel).finally(() => { polarionStatus.update(pol.polarion); });
    }
  });
}

// this method is called when your extension is deactivated
export function deactivate() { }











