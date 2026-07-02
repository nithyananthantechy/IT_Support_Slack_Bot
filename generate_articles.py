import json
import os

articles_dir = r"c:\Users\Nithyananthan\Desktop\DesiCrew_Slack_Bot\articles"

software_list = [
    {
        "name": "Zoho (e.g., Zoho Mail / CRM App)",
        "file_name": "zoho_installation.json",
        "keywords": ["zoho", "zoho mail", "zoho crm", "install zoho", "zoho app"],
        "download_link": "https://www.zoho.com/downloads.html",
        "install_steps": [
            "Download the appropriate Zoho app for your OS from the official website.",
            "Run the installer file.",
            "Follow the on-screen instructions to complete setup.",
            "Log in with your company credentials."
        ]
    },
    {
        "name": "SQL Server (Management Studio / Express)",
        "file_name": "sql_server_installation.json",
        "keywords": ["sql server", "ssms", "sql express", "install sql", "sql management studio"],
        "download_link": "https://www.microsoft.com/en-us/sql-server/sql-server-downloads",
        "install_steps": [
            "Download SQL Server Developer/Express or SSMS depending on your requirement.",
            "Run the installer as Administrator.",
            "Choose 'Basic' or 'Custom' installation type.",
            "Accept the terms and follow prompts to complete the installation."
        ]
    },
    {
        "name": "FortiClient VPN",
        "file_name": "forticlient_vpn_installation.json",
        "keywords": ["forticlient", "vpn", "forti", "forticlient vpn", "install vpn"],
        "download_link": "https://www.fortinet.com/support/product-downloads",
        "install_steps": [
            "Download the FortiClient VPN installer from the provided link.",
            "Run the installer and accept the terms of the license agreement.",
            "Click Next and Finish the installation.",
            "Open FortiClient, configure the VPN connection with IT-provided server details, and log in."
        ]
    },
    {
        "name": "WPS Office",
        "file_name": "wps_installation.json",
        "keywords": ["wps", "wps office", "install wps", "office alternative"],
        "download_link": "https://www.wps.com/download/",
        "install_steps": [
            "Download the WPS Office installer.",
            "Run the executable file.",
            "Review and accept the Privacy Policy and Terms of Service.",
            "Click 'Install Now' and wait for it to finish."
        ]
    },
    {
        "name": "Google Chrome",
        "file_name": "google_chrome_installation.json",
        "keywords": ["chrome", "google chrome", "install chrome", "browser"],
        "download_link": "https://www.google.com/chrome/",
        "install_steps": [
            "Click 'Download Chrome' on the official web page.",
            "Run the `ChromeSetup.exe` file.",
            "If prompted directly by User Account Control, click 'Yes'.",
            "Wait for Chrome to download and install automatically."
        ]
    },
    {
        "name": "Microsoft 365 (Office Apps)",
        "file_name": "microsoft_365_installation.json",
        "keywords": ["o365", "office 365", "microsoft 365", "install office", "word", "excel", "powerpoint"],
        "download_link": "https://www.office.com/",
        "install_steps": [
            "Log in to office.com with your work account.",
            "Click on 'Install apps' near the top right.",
            "Select 'Microsoft 365 apps' to download the installer.",
            "Run the downloaded file and wait for Office to install in the background."
        ]
    },
    {
        "name": "AnyDesk",
        "file_name": "anydesk_installation.json",
        "keywords": ["anydesk", "remote desktop", "install anydesk", "remote assist"],
        "download_link": "https://anydesk.com/en/downloads/windows",
        "install_steps": [
            "Download Anydesk `.exe` file.",
            "You can run it as a portable app directly, or click 'Install AnyDesk on this device' from the opened app.",
            "Accept the terms to proceed with the installation.",
            "Provide your AnyDesk ID to IT for remote support."
        ]
    },
    {
        "name": "UltraViewer",
        "file_name": "ultraviewer_installation.json",
        "keywords": ["ultraviewer", "remote support", "install ultraviewer"],
        "download_link": "https://ultraviewer.net/en/download.html",
        "install_steps": [
            "Download the UltraViewer Setup (EXE) file.",
            "Run the installer as Administrator.",
            "Follow the standard installation wizard (Next, Install, Finish).",
            "Open the app and share your ID/Password for remote assistance."
        ]
    },
    {
        "name": "Slack",
        "file_name": "slack_installation.json",
        "keywords": ["slack", "install slack", "messaging app", "chat app"],
        "download_link": "https://slack.com/downloads/windows",
        "install_steps": [
            "Download Slack for Windows.",
            "Double-click the downloaded setup file.",
            "Slack will automatically install and open.",
            "Sign in to your company workspace using your email."
        ]
    },
    {
        "name": "Loom",
        "file_name": "loom_installation.json",
        "keywords": ["loom", "screen recorder", "install loom", "record screen"],
        "download_link": "https://www.loom.com/desktop",
        "install_steps": [
            "Download the Loom desktop app.",
            "Run the installer file.",
            "Once installed, open Loom and sign in with your work email.",
            "Grant microphone and camera permissions when prompted."
        ]
    },
    {
        "name": "Capture2Text",
        "file_name": "capture2text_installation.json",
        "keywords": ["capture2text", "ocr", "extract text", "install capture2text"],
        "download_link": "https://sourceforge.net/projects/capture2text/files/Capture2Text/",
        "install_steps": [
            "Download the newest zip file from SourceForge.",
            "Extract the ZIP file contents to a folder on your PC (e.g., in Documents or Program Files).",
            "This is a portable app. Double click `Capture2Text.exe` to run it.",
            "A tray icon will appear. Use the default hotkey (Win+Q) to start OCR."
        ]
    },
    {
        "name": "VLC Media Player",
        "file_name": "vlc_installation.json",
        "keywords": ["vlc", "vlc media player", "video player", "install vlc"],
        "download_link": "https://www.videolan.org/vlc/download-windows.html",
        "install_steps": [
            "Download the VLC installer.",
            "Run the downloaded executable.",
            "Follow the setup wizard, accepting the license agreement.",
            "Click Finish to complete the installation."
        ]
    },
    {
        "name": "Python",
        "file_name": "python_installation.json",
        "keywords": ["python", "install python", "python 3"],
        "download_link": "https://www.python.org/downloads/",
        "install_steps": [
            "Download the latest stable release for Windows.",
            "Run the installer.",
            "IMPORTANT: Check the box 'Add Python to PATH' at the bottom of the installer window.",
            "Click 'Install Now' and wait for it to finish."
        ]
    },
    {
        "name": "Subtitle Edit",
        "file_name": "subtitle_edit_installation.json",
        "keywords": ["subtitle edit", "subtitles", "install subtitle edit"],
        "download_link": "https://github.com/SubtitleEdit/subtitleedit/releases",
        "install_steps": [
            "Download the Setup.zip or Setup.exe from the releases page.",
            "Run the installer.",
            "Follow the on-screen instructions.",
            "Note: You may need VLC installed beforehand for video preview integration."
        ]
    },
    {
        "name": "Audacity",
        "file_name": "audacity_installation.json",
        "keywords": ["audacity", "audio editor", "install audacity"],
        "download_link": "https://www.audacityteam.org/download/",
        "install_steps": [
            "Download the Audacity Windows installer.",
            "Run the `.exe` file.",
            "Proceed through the wizard, read the GNU GPL info, and click Install.",
            "Launch Audacity once complete."
        ]
    },
    {
        "name": "Rocket Broadcaster",
        "file_name": "rocket_broadcaster_installation.json",
        "keywords": ["rocket broadcaster", "broadcaster", "install rocket"],
        "download_link": "https://www.rocketbroadcaster.com/download/",
        "install_steps": [
            "Download the Free or Pro edition depending on IT instructions.",
            "Run the installer as Administrator.",
            "Follow the installation prompts.",
            "Launch and configure your stream settings."
        ]
    },
    {
        "name": "Java 8 (JRE/JDK)",
        "file_name": "java8_installation.json",
        "keywords": ["java", "java 8", "jre", "jdk", "install java"],
        "download_link": "https://www.oracle.com/java/technologies/javase/javase-jdk8-downloads.html",
        "install_steps": [
            "Download the Windows x64 Installer (requires Oracle account login).",
            "Run the executable.",
            "Click Next through the setup wizard.",
            "Update Environment Variables (JAVA_HOME and PATH) if requested by your project."
        ]
    },
    {
        "name": "Android Studio",
        "file_name": "android_studio_installation.json",
        "keywords": ["android studio", "install android studio", "android dev"],
        "download_link": "https://developer.android.com/studio",
        "install_steps": [
            "Download the Android Studio setup file.",
            "Run the installer and leave the default components (Android Virtual Device) checked.",
            "Proceed through the installation wizard.",
            "Upon first launch, complete the Setup Wizard to download the SDK and emulator components."
        ]
    },
    {
        "name": "Visual Studio",
        "file_name": "visual_studio_installation.json",
        "keywords": ["visual studio", "vs", "install visual studio", "visual studio community"],
        "download_link": "https://visualstudio.microsoft.com/downloads/",
        "install_steps": [
            "Download the Visual Studio Installer.",
            "Run it to open the Workloads selection screen.",
            "Select the specific workloads you need (e.g., .NET desktop, Node.js, Python).",
            "Click Install and wait for the large download to complete."
        ]
    },
    {
        "name": "Firefox",
        "file_name": "firefox_installation.json",
        "keywords": ["firefox", "mozilla", "install firefox", "browser"],
        "download_link": "https://www.mozilla.org/en-US/firefox/new/",
        "install_steps": [
            "Download the Firefox Installer.",
            "Run the file and User Account Control will prompt you to run as an admin.",
            "The installer runs in the background and will open Firefox when finished."
        ]
    },
    {
        "name": "GitHub Desktop",
        "file_name": "github_desktop_installation.json",
        "keywords": ["github", "github desktop", "install github", "git"],
        "download_link": "https://desktop.github.com/",
        "install_steps": [
            "Download GitHub Desktop for Windows.",
            "Run the installer.",
            "It will install automatically and prompt you to sign in to your GitHub account.",
            "If you need Git CLI, download it separately from git-scm.com."
        ]
    },
    {
        "name": "Node.js",
        "file_name": "nodejs_installation.json",
        "keywords": ["node", "nodejs", "node.js", "npm", "install node"],
        "download_link": "https://nodejs.org/en/download/",
        "install_steps": [
            "Download the LTS (Long Term Support) Windows Installer.",
            "Run the `.msi` file.",
            "Accept the license agreement and leave default paths.",
            "Ensure 'npm package manager' and 'Add to PATH' are selected. Finish install."
        ]
    },
    {
        "name": "Cypress",
        "file_name": "cypress_installation.json",
        "keywords": ["cypress", "install cypress", "testing tool"],
        "download_link": "https://docs.cypress.io/guides/getting-started/installing-cypress",
        "install_steps": [
            "Ensure Node.js is installed first.",
            "Open your terminal in your project directory.",
            "Run the command: `npm install cypress --save-dev`",
            "To open Cypress, run: `npx cypress open`"
        ]
    },
    {
        "name": "Lightshot",
        "file_name": "lightshot_installation.json",
        "keywords": ["lightshot", "screenshot", "install lightshot", "screen capture"],
        "download_link": "https://app.prntscr.com/en/download.html",
        "install_steps": [
            "Download Lightshot for Windows.",
            "Run the installer.",
            "Select your language and accept the agreement.",
            "Once installed, press 'Print Screen' on your keyboard to use it."
        ]
    },
    {
        "name": "Windows App (AVD)",
        "file_name": "windows_app_avd_installation.json",
        "keywords": ["windows app", "avd", "azure virtual desktop", "install windows app"],
        "download_link": "https://apps.microsoft.com/detail/9N1F85V9T8BN (or IT-provided Azure link)",
        "install_steps": [
            "Install 'Windows App' from the Microsoft Store or via direct download.",
            "Open the app.",
            "Click 'Subscribe' or 'Add Workspace'.",
            "Log in with your company credentials to access your remote desktop."
        ]
    },
    {
        "name": "AXIS Client VPN",
        "file_name": "axis_client_vpn_installation.json",
        "keywords": ["axis vpn", "axis client vpn", "install axis", "axis security"],
        "download_link": "Provided via IT Portal / Security Admin",
        "install_steps": [
            "Download the Axis Client installer provided by IT.",
            "Run the installer as Administrator.",
            "Follow the guided setup.",
            "Launch Axis Client and sign in with your corporate SSO."
        ]
    }
]

step1_base = "*🔐 Step 1: Get IT Approval First (MANDATORY)*\n• You MUST get permission from the IT team before installing ANY software on a company machine.\n• Raise a request to the IT Helpdesk specifying you need {0}.\n• Do NOT proceed with installation until IT confirms approval.\n_Expected: You receive IT approval confirmation._"

step2_base = "*📥 Step 2: Download {0}*\n• Once approved, download the setup file from:\n`{1}`\n• Save the file locally.\n_Expected: Download finishes._"

for sw in software_list:
    json_data = {
        "title": f"{sw['name']} Installation Guide",
        "keywords": sw['keywords'],
        "issue_type": "software_install",
        "steps": [
            {
                "instruction": step1_base.format(sw['name'])
            },
            {
                "instruction": step2_base.format(sw['name'], sw['download_link'])
            }
        ]
    }
    
    # Add custom steps
    step_num = 3
    icon_map = {3: "🖱️", 4: "⚙️", 5: "🔑", 6: "✅"}
    for step in sw['install_steps']:
        icon = icon_map.get(step_num, "✅")
        instruction = f"*{icon} Step {step_num}: Installation Instruction*\n• {step}\n_Expected: Step {step_num} is completed._"
        json_data['steps'].append({"instruction": instruction})
        step_num += 1
        
    file_path = os.path.join(articles_dir, sw['file_name'])
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(json_data, f, indent=2)
