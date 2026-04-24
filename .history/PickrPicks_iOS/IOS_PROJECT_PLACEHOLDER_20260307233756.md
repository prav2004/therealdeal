# iOS project placeholder

This repo includes the SwiftUI source in `PickrPicks_iOS/SwiftUIStarter/`.

A real `.xcodeproj` must be created on macOS with Xcode. On your iMac:

1) Create a new iOS App project in Xcode.
   - Product Name: PickrPicks
   - Interface: SwiftUI
   - Language: Swift
   - Minimum iOS: 16.0

2) Drag the files from `PickrPicks_iOS/SwiftUIStarter/` into the Xcode project.

3) Add FirebaseAuth using Swift Package Manager.

4) Download `GoogleService-Info.plist` from Firebase Console and add it to the Xcode target.

Notes:
- `GoogleService-Info.plist` is gitignored on purpose.
- API base URL is in `SwiftUIStarter/Services/APIConfig.swift`.
