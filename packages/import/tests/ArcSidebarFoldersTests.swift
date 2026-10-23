import Foundation
import XCTest
@testable import ArdiaImportCore

/// Arc keeps folders in two shapes: the old `list` item (named on the item) and the newer `tabGroup` item (named in
/// its data). Both must survive the import, in the pinned section as folders and in Today as groups.
final class ArcSidebarFoldersTests: XCTestCase {
  private func tab(_ id: String, _ parent: String, _ url: String, _ title: String) -> [String: Any] {
    ["id": id, "parentID": parent, "childrenIds": [], "title": NSNull(), "data": ["tab": ["savedURL": url, "savedTitle": title]]]
  }

  private func sidebar(items: [[String: Any]]) throws -> ArcSidebar {
    let space: [String: Any] = [
      "id": "S-1", "title": "Study", "profile": ["default": true],
      "containerIDs": ["unpinned", "TODAY", "pinned", "PIN"],
      "newContainerIDs": [["unpinned": ["_0": ["shared": [:]]]], "TODAY", ["pinned": [:]], "PIN"],
      "customInfo": [:],
    ]
    let box: [String: Any] = ["items": items, "spaces": [space], "topAppsContainerIDs": []]
    let top: [String: Any] = ["version": 1, "sidebar": ["containers": [["global": [:]], box]]]
    return try ArcSidebar.parse(JSONSerialization.data(withJSONObject: top))
  }

  func testPinnedTabGroupsImportAsFolders() throws {
    let s = try sidebar(items: [
      ["id": "PIN", "parentID": NSNull(), "childrenIds": ["T-1", "G-1", "L-1"], "title": NSNull(),
       "data": ["itemContainer": ["containerType": ["spaceItems": ["_0": "S-1"]]]]],
      tab("T-1", "PIN", "https://cal.example/", "Calendar"),
      ["id": "G-1", "parentID": "PIN", "childrenIds": ["T-2", "T-3"], "title": NSNull(), "data": ["tabGroup": ["title": "Linear Algebra"]]],
      tab("T-2", "G-1", "https://la.example/1", "Lecture 1"),
      tab("T-3", "G-1", "https://la.example/2", "Lecture 2"),
      ["id": "L-1", "parentID": "PIN", "childrenIds": ["T-4"], "title": "Reading", "data": ["list": [:]]],
      tab("T-4", "L-1", "https://read.example/", "A post"),
      ["id": "TODAY", "parentID": NSNull(), "childrenIds": [], "title": NSNull(),
       "data": ["itemContainer": ["containerType": ["spaceItems": ["_0": "S-1"]]]]],
    ])
    let space = try XCTUnwrap(s.spaces.first)
    XCTAssertEqual(space.pinned.map(\.title), ["Calendar", "Linear Algebra", "Reading"])
    XCTAssertEqual(space.pinned[1].type, .folder)
    XCTAssertEqual(space.pinned[1].children?.map(\.url), ["https://la.example/1", "https://la.example/2"])
    XCTAssertEqual(space.pinned[2].children?.map(\.title), ["A post"])
    XCTAssertNil(space.groups)
  }

  func testTodayFoldersImportAsGroupsInSidebarOrder() throws {
    let s = try sidebar(items: [
      ["id": "PIN", "parentID": NSNull(), "childrenIds": [], "title": NSNull(),
       "data": ["itemContainer": ["containerType": ["spaceItems": ["_0": "S-1"]]]]],
      ["id": "TODAY", "parentID": NSNull(), "childrenIds": ["T-1", "G-1", "T-4", "L-1", "E-1"], "title": NSNull(),
       "data": ["itemContainer": ["containerType": ["spaceItems": ["_0": "S-1"]]]]],
      tab("T-1", "TODAY", "https://loose.example/", "Loose"),
      ["id": "G-1", "parentID": "TODAY", "childrenIds": ["T-2", "N-1"], "title": NSNull(), "data": ["tabGroup": ["title": "Philosophy"]]],
      tab("T-2", "G-1", "https://phil.example/1", "Kant"),
      ["id": "N-1", "parentID": "G-1", "childrenIds": ["T-3"], "title": "Nested", "data": ["list": [:]]],
      tab("T-3", "N-1", "https://phil.example/2", "Hume"),
      tab("T-4", "TODAY", "https://loose.example/2", "Loose too"),
      ["id": "L-1", "parentID": "TODAY", "childrenIds": ["T-5"], "title": "Travel", "data": ["list": [:]]],
      tab("T-5", "L-1", "https://travel.example/", "Flights"),
      ["id": "E-1", "parentID": "TODAY", "childrenIds": [], "title": "Empty", "data": ["tabGroup": ["title": "Empty"]]],
    ])
    let space = try XCTUnwrap(s.spaces.first)
    XCTAssertEqual(space.tabs.map(\.title), ["Loose", "Kant", "Hume", "Loose too", "Flights"])
    XCTAssertEqual(space.tabs.map { $0.groupId ?? "-" }, ["-", "G-1", "G-1", "-", "L-1"])
    XCTAssertEqual(space.groups?.map(\.title), ["Philosophy", "Travel"], "an empty folder makes no group")
    XCTAssertEqual(space.groups?.map(\.id), ["G-1", "L-1"])
    XCTAssertTrue(space.tabs.allSatisfy { !$0.pinned })
  }

  func testTheOwnersRenameWinsOverTheGroupsName() throws {
    let s = try sidebar(items: [
      ["id": "PIN", "parentID": NSNull(), "childrenIds": ["G-1"], "title": NSNull(),
       "data": ["itemContainer": ["containerType": ["spaceItems": ["_0": "S-1"]]]]],
      ["id": "G-1", "parentID": "PIN", "childrenIds": ["T-1"], "title": "Renamed", "data": ["tabGroup": ["title": "Original"]]],
      tab("T-1", "G-1", "https://a.example/", "A"),
      ["id": "TODAY", "parentID": NSNull(), "childrenIds": [], "title": NSNull(),
       "data": ["itemContainer": ["containerType": ["spaceItems": ["_0": "S-1"]]]]],
    ])
    XCTAssertEqual(s.spaces.first?.pinned.first?.title, "Renamed")
  }
}
