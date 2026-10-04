#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace GameUi.PanelHarness.Editor
{
    // Only the disposable acceptance project invokes this entry point.
    [InitializeOnLoad]
    public static class PanelExportSmoke
    {
        private const string KEY = "PanelHarness.ExportSmoke.";
        private const string SEARCH_STARTUP_KEY = "IndexingOnEditorStartup_Started";
        private const float EDITOR_STARTUP_TIMEOUT_SECONDS = 120f;
        [Serializable] private sealed class Check { public string name; public string status = "PASS"; }
        [Serializable] private sealed class Artifact { public string path, sha256; public long bytes; }
        [Serializable] private sealed class LogDetail { public string stage, message, stackTrace; }
        [Serializable] private sealed class Identity { public string panelSha256, previousPanelSha256, prefabGuid, runtimeSha256; public int revision; }
        [Serializable] private sealed class Coverage
        {
            public int sourceNodes, textNodes, readOnlyControls, scrollViews, images, spriteRegions, currentValuesDifferentFromInitial;
            public int sliders, switches, selects, buttons, progressBars, disabledControls, resetFields, preservedResetFields;
            public int visibleTextMeshes, sliderThumbs;
        }
        [Serializable] private sealed class Report
        {
            public string status = "RUNNING", panelId = "", panelSha256 = "", error = "", failureStage = "";
            public List<Check> checks = new List<Check>();
            public List<string> unexpectedLogMessages = new List<string>();
            public List<LogDetail> unexpectedLogDetails = new List<LogDetail>();
            public List<Artifact> artifacts = new List<Artifact>();
            public Coverage coverage = new Coverage();
            public int expectedErrorLogs, unexpectedErrorLogs;
            public bool playMode, rendered;
            public string prefab = "", package = "panel.unitypackage", screenshot = "";
        }
        private static Report report;
        private static int firstFrame, phase, expectedErrors;
        private static float captureNotBefore;
        private static bool finishing, reportingFailure;
        private static string currentStage = "initialization";
        private static Camera renderCamera;
        private static RenderTexture renderTexture;
        private static GameObject instance;

        static PanelExportSmoke()
        {
            EditorApplication.playModeStateChanged += PlayModeChanged;
            Application.logMessageReceived += Logged;
            if (SessionState.GetBool(KEY + "waitingForEditor", false))
            {
                report = JsonUtility.FromJson<Report>(SessionState.GetString(KEY + "report", "{}"));
                currentStage = "wait-editor-startup";
                EditorApplication.update += WaitForEditorStartup;
            }
        }

        public static void Run()
        {
            report = new Report();
            try
            {
                currentStage = "read-input";
                string kit = Argument("--panel-kit", "Assets/PanelHarness/Kit");
                string fontPath = Argument("--panel-font", "Assets/PanelHarness/TestFont.otf");
                string reportPath = Absolute(Argument("--panel-report", "../unity-smoke.json"));
                SessionState.SetString(KEY + "reportPath", reportPath);
                SessionState.SetString(KEY + "kit", kit);
                SessionState.SetBool(KEY + "render", Environment.GetCommandLineArgs().Contains("--panel-render"));
                string documentPath = Absolute(kit + "/panel.unity.json");
                PanelDocument document = JsonUtility.FromJson<PanelDocument>(File.ReadAllText(documentPath, Encoding.UTF8));
                string output = Argument("--panel-output", "Assets/PanelHarness/Panels/" + document.panelId);
                report.panelId = document.panelId; report.panelSha256 = document.panelSha256;
                Font font = AssetDatabase.LoadAssetAtPath<Font>(fontPath);
                Ensure(font != null && EditorUtility.IsPersistent(font), "persistent-test-font");

                bool rejected = false;
                try { PanelPrefabBuilder.Build(documentPath, output + "-rejected", null); }
                catch (ArgumentException) { rejected = true; }
                Ensure(rejected && !Directory.Exists(Absolute(output + "-rejected")), "invalid-font-rejected-before-mutation");
                rejected = false;
                try { PanelPrefabBuilder.Build(documentPath, "Assets/../PanelSmokeEscape", font); }
                catch (ArgumentException) { rejected = true; }
                Ensure(rejected, "output-traversal-rejected");

                currentStage = "build-prefab";
                string baseSha = Argument("--panel-base-sha", "");
                string prefabPath;
                if (baseSha == "") prefabPath = PanelPrefabBuilder.Build(documentPath, output, font);
                else
                {
                    currentStage = "update-existing-prefab";
                    prefabPath = output + "/" + document.nodes[0].id + ".prefab";
                    GameObject previousPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                    Ensure(previousPrefab != null, "baseline-native-prefab-imported");
                    Identity previous = JsonUtility.FromJson<Identity>(PanelPrefabBuilder.GetIdentityJson(prefabPath));
                    Ensure(previous.panelSha256 == baseSha, "baseline-source-digest-matches-request");
                    Dictionary<string, long> beforeIds = PersistentIdentifiers(previousPrefab);
                    byte[] beforePrefab = File.ReadAllBytes(Absolute(prefabPath));
                    byte[] beforeIdentity = File.ReadAllBytes(Absolute(output + "/panel-identity.json"));
                    rejected = false;
                    try { PanelPrefabBuilder.Update(documentPath, prefabPath, font, new string('0', 64)); }
                    catch (InvalidOperationException exception) { rejected = exception.Message == "PANEL_UPDATE_STALE_BASE"; }
                    Ensure(rejected && beforePrefab.SequenceEqual(File.ReadAllBytes(Absolute(prefabPath)))
                        && beforeIdentity.SequenceEqual(File.ReadAllBytes(Absolute(output + "/panel-identity.json"))), "stale-update-rejected-without-prefab-or-identity-write");
                    File.WriteAllBytes(Absolute(prefabPath), beforePrefab.Concat(new byte[] { 10 }).ToArray());
                    rejected = false;
                    try { PanelPrefabBuilder.Update(documentPath, prefabPath, font, baseSha); }
                    catch (InvalidDataException exception) { rejected = exception.Message == "PANEL_IDENTITY_PREFAB_CHANGED"; }
                    finally { File.WriteAllBytes(Absolute(prefabPath), beforePrefab); }
                    Ensure(rejected && beforeIdentity.SequenceEqual(File.ReadAllBytes(Absolute(output + "/panel-identity.json"))), "local-prefab-modification-rejected-before-update");
                    rejected = false;
                    try { PanelPrefabBuilder.Build(documentPath, output, font); }
                    catch (IOException) { rejected = true; }
                    Ensure(rejected, "new-build-refuses-existing-panel-folder");

                    string rejectedFolder = Path.Combine(Path.GetDirectoryName(documentPath), "rejected-update");
                    Directory.CreateDirectory(rejectedFolder);
                    string rejectedDocument = Path.Combine(rejectedFolder, "panel.unity.json");
                    string runtimeSource = Path.Combine(Path.GetDirectoryName(documentPath), "unity-runtime.json");
                    File.WriteAllBytes(rejectedDocument, File.ReadAllBytes(documentPath));
                    File.WriteAllText(Path.Combine(rejectedFolder, "unity-runtime.json"), "{\"adapterVersion\":\"0.1.1\",\"runtimeSha256\":\"" + new string('0', 64) + "\"}", new UTF8Encoding(false));
                    rejected = false;
                    try { PanelPrefabBuilder.Update(rejectedDocument, prefabPath, font, baseSha); }
                    catch (InvalidDataException exception) { rejected = exception.Message == "PANEL_IMPORT_RUNTIME_IDENTITY_MISMATCH"; }
                    Ensure(rejected && beforePrefab.SequenceEqual(File.ReadAllBytes(Absolute(prefabPath))), "runtime-fingerprint-mismatch-rejected-before-update");
                    PanelDocument wrongPanel = JsonUtility.FromJson<PanelDocument>(File.ReadAllText(documentPath, Encoding.UTF8));
                    wrongPanel.panelId = "another-panel";
                    File.WriteAllText(rejectedDocument, JsonUtility.ToJson(wrongPanel), new UTF8Encoding(false));
                    File.WriteAllBytes(Path.Combine(rejectedFolder, "unity-runtime.json"), File.ReadAllBytes(runtimeSource));
                    foreach (PanelAsset asset in document.assets)
                    {
                        string destination = Path.Combine(rejectedFolder, asset.path);
                        Directory.CreateDirectory(Path.GetDirectoryName(destination));
                        File.WriteAllBytes(destination, File.ReadAllBytes(Path.Combine(Path.GetDirectoryName(documentPath), asset.path)));
                    }
                    rejected = false;
                    try { PanelPrefabBuilder.Update(rejectedDocument, prefabPath, font, baseSha); }
                    catch (ArgumentException exception) { rejected = exception.Message == "PANEL_IMPORT_PANEL_ID_FOLDER_REQUIRED"; }
                    Ensure(rejected && beforePrefab.SequenceEqual(File.ReadAllBytes(Absolute(prefabPath))), "different-panel-id-rejected-before-update");

                    Slider previousSlider = previousPrefab.GetComponentsInChildren<Slider>(true).First();
                    string previousSliderName = previousSlider.name;
                    Sprite previousSprite = previousPrefab.GetComponentsInChildren<Image>(true).Select(value => value.sprite).First(value => value != null);
                    Scene referenceScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                    GameObject referenceInstance = (GameObject)PrefabUtility.InstantiatePrefab(previousPrefab, referenceScene);
                    GameObject referenceHost = new GameObject("__SavedReference", typeof(RectTransform), typeof(Button), typeof(Image));
                    Navigation navigation = referenceHost.GetComponent<Button>().navigation;
                    navigation.mode = Navigation.Mode.Explicit;
                    navigation.selectOnDown = referenceInstance.GetComponentsInChildren<Slider>(true).Single(value => value.name == previousSliderName);
                    referenceHost.GetComponent<Button>().navigation = navigation;
                    referenceHost.GetComponent<Image>().sprite = previousSprite;
                    EditorUtility.SetDirty(referenceHost.GetComponent<Button>());
                    string referenceScenePath = output + "/References.unity";
                    Ensure(EditorSceneManager.SaveScene(referenceScene, referenceScenePath), "host-reference-test-scene-saved");
                    byte[] savedScene = File.ReadAllBytes(Absolute(referenceScenePath));
                    EditorSceneManager.OpenScene(referenceScenePath, OpenSceneMode.Single);
                    Ensure(GameObject.Find("__SavedReference").GetComponent<Button>().navigation.selectOnDown != null, "scene-reference-fixture-survives-save-before-update");

                    PanelPrefabBuilder.Update(documentPath, prefabPath, font, baseSha);
                    GameObject nextPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                    Identity next = JsonUtility.FromJson<Identity>(PanelPrefabBuilder.GetIdentityJson(prefabPath));
                    Ensure(next.prefabGuid == previous.prefabGuid, "updated-prefab-guid-is-preserved");
                    Ensure(next.revision == previous.revision + 1 && next.panelSha256 == document.panelSha256
                        && next.previousPanelSha256 == baseSha, "update-revision-and-base-digest-are-recorded");
                    Dictionary<string, long> afterIds = PersistentIdentifiers(nextPrefab);
                    Ensure(beforeIds.All(pair => !afterIds.ContainsKey(pair.Key) || afterIds[pair.Key] == pair.Value), "surviving-gameobjects-and-components-preserve-local-identifiers");
                    Ensure(savedScene.SequenceEqual(File.ReadAllBytes(Absolute(referenceScenePath))), "update-does-not-rewrite-host-scene");
                    EditorSceneManager.OpenScene(referenceScenePath, OpenSceneMode.Single);
                    GameObject loadedReference = GameObject.Find("__SavedReference");
                    Selectable loadedControl = loadedReference.GetComponent<Button>().navigation.selectOnDown;
                    Ensure(loadedControl != null && PrefabUtility.GetCorrespondingObjectFromSource(loadedControl) == nextPrefab.GetComponentsInChildren<Slider>(true).Single(value => value.name == previousSliderName)
                        && loadedReference.GetComponent<Image>().sprite == previousSprite, "saved-scene-instance-control-and-sprite-references-survive-reload");
                }
                report.prefab = prefabPath;
                SessionState.SetString(KEY + "prefab", prefabPath);
                AssetDatabase.SaveAssets();
                AssetDatabase.ImportAsset(prefabPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
                GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                Ensure(prefab != null && PrefabUtility.IsPartOfPrefabAsset(prefab), "native-prefab-saved-and-loaded");
                Identity installed = JsonUtility.FromJson<Identity>(PanelPrefabBuilder.GetIdentityJson(prefabPath));
                Ensure(installed.panelSha256 == document.panelSha256 && installed.revision >= 1, "managed-panel-identity-matches-native-prefab");
                VerifyNoMissingScripts(prefab);
                CheckPass("prefab-has-no-missing-scripts");
                VerifyGeometry(document, prefab, true);
                RecordArtifact(Absolute(prefabPath), "project/" + prefabPath);

                string packagePath = Absolute("../panel.unitypackage");
                currentStage = "export-unitypackage";
                PanelPrefabBuilder.ExportPackage(prefabPath, packagePath);
                Ensure(File.Exists(packagePath) && new FileInfo(packagePath).Length > 0, "native-unitypackage-written");
                RecordArtifact(packagePath, "panel.unitypackage");
                string[] dependencies = AssetDatabase.GetDependencies(prefabPath, true);
                Text[] textComponents = prefab.GetComponentsInChildren<Text>(true);
                string[] copiedFontPaths = textComponents.Select(text => AssetDatabase.GetAssetPath(text.font)).Distinct().ToArray();
                Ensure(copiedFontPaths.Length == 1 && copiedFontPaths[0].StartsWith(output + "/Fonts/", StringComparison.Ordinal)
                    && dependencies.Contains(copiedFontPaths[0]) && !dependencies.Contains(fontPath), "prefab-uses-panel-local-font-copy");
                Ensure(File.ReadAllBytes(Absolute(copiedFontPaths[0])).SequenceEqual(File.ReadAllBytes(Absolute(fontPath))), "font-copy-preserves-source-bytes");
                Ensure(dependencies.Where(path => path.StartsWith("Assets/", StringComparison.Ordinal)).All(path => path.StartsWith("Assets/PanelHarness/", StringComparison.Ordinal)), "native-dependencies-share-one-root");

                // Prove that another host folder cannot silently enter the native package.
                string outsideFontPath = "Assets/OutsideFont" + Path.GetExtension(fontPath);
                Ensure(AssetDatabase.CopyAsset(fontPath, outsideFontPath), "outside-font-test-fixture-created");
                Scene rejectionScene = EditorSceneManager.NewPreviewScene();
                string rejectionPrefab = output + "/outside-dependency.prefab";
                try
                {
                    GameObject rejectionRoot = (GameObject)PrefabUtility.InstantiatePrefab(prefab, rejectionScene);
                    rejectionRoot.GetComponentsInChildren<Text>(true)[0].font = AssetDatabase.LoadAssetAtPath<Font>(outsideFontPath);
                    PrefabUtility.SaveAsPrefabAsset(rejectionRoot, rejectionPrefab);
                }
                finally { EditorSceneManager.ClosePreviewScene(rejectionScene); }
                string rejectedPackage = Absolute("../rejected.unitypackage");
                rejected = false;
                try { PanelPrefabBuilder.ExportPackage(rejectionPrefab, rejectedPackage); }
                catch (InvalidOperationException exception) { rejected = exception.Message == "PANEL_EXPORT_DEPENDENCY_OUTSIDE_ADAPTER_ROOT"; }
                Ensure(rejected && !File.Exists(rejectedPackage), "outside-root-dependency-rejected-before-package-write");
                AssetDatabase.DeleteAsset(rejectionPrefab);
                AssetDatabase.DeleteAsset(outsideFontPath);

                currentStage = "create-test-scene";
                Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                GameObject created = (GameObject)PrefabUtility.InstantiatePrefab(prefab, scene);
                Ensure(created != null && created.GetComponent<PanelController>() != null, "prefab-instantiated-in-isolated-scene");
                if (UnityEngine.Object.FindFirstObjectByType<EventSystem>() == null)
                    new GameObject("__SmokeEventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
                Ensure(EditorSceneManager.SaveScene(scene, output + "/Smoke.unity"), "isolated-smoke-scene-saved");
                currentStage = "wait-editor-startup";
                SessionState.SetFloat(KEY + "editorDeadline", (float)EditorApplication.timeSinceStartup + EDITOR_STARTUP_TIMEOUT_SECONDS);
                SessionState.SetBool(KEY + "waitingForEditor", true);
                SessionState.SetString(KEY + "report", JsonUtility.ToJson(report));
                EditorApplication.update -= WaitForEditorStartup;
                EditorApplication.update += WaitForEditorStartup;
            }
            catch (Exception exception) { FailRun(exception); }
        }

        private static void WaitForEditorStartup()
        {
            if (finishing) return;
            try
            {
                currentStage = "wait-editor-startup";
                Assert(!EditorApplication.isPlayingOrWillChangePlaymode, "editor-startup-remains-in-edit-mode");
                Assert(EditorApplication.timeSinceStartup <= SessionState.GetFloat(KEY + "editorDeadline", 0), "editor-startup-readiness-timeout");
                Assert(report.unexpectedErrorLogs == 0, "no-unexpected-editor-startup-error-logs");
                if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
                string searchIndex = Absolute("UserSettings/Search.index");
                // Unity 6000.3.7f1 SearchInit schedules default-index creation on delayCall.
                // Its marker is set only after GetDefaultSearchDatabase succeeds. Entering
                // Play Mode earlier prevents first-use creation and indexes an empty list.
                // See UnityCsReference/6000.3.7f1/Modules/QuickSearch/Editor/SearchInit.cs.
                if (!SessionState.GetBool(SEARCH_STARTUP_KEY, false) || !File.Exists(searchIndex) || new FileInfo(searchIndex).Length == 0) return;
                EditorApplication.update -= WaitForEditorStartup;
                SessionState.SetBool(KEY + "waitingForEditor", false);
                CheckPass("editor-search-initialized-before-play-mode");
                // Include every startup log recorded during the wait before the domain reload.
                SessionState.SetString(KEY + "report", JsonUtility.ToJson(report));
                SessionState.SetBool(KEY + "pending", true);
                currentStage = "enter-play-mode";
                EditorApplication.EnterPlaymode();
            }
            catch (Exception exception) { FailRun(exception); }
        }

        private static string Argument(string name, string fallback)
        {
            string[] arguments = Environment.GetCommandLineArgs();
            int index = Array.IndexOf(arguments, name);
            return index >= 0 && index + 1 < arguments.Length ? arguments[index + 1] : fallback;
        }

        private static Dictionary<string, long> PersistentIdentifiers(GameObject prefab)
        {
            Dictionary<string, long> result = new Dictionary<string, long>(StringComparer.Ordinal);
            foreach (Transform transform in prefab.GetComponentsInChildren<Transform>(true))
            {
                List<UnityEngine.Object> values = new List<UnityEngine.Object> { transform.gameObject };
                values.AddRange(transform.GetComponents<Component>());
                foreach (UnityEngine.Object value in values)
                {
                    string guid = null; long localId = 0;
                    Assert(value != null && AssetDatabase.TryGetGUIDAndLocalFileIdentifier(value, out guid, out localId), "persistent-object-local-id-required");
                    result.Add(transform.name + ":" + value.GetType().FullName, localId);
                }
            }
            return result;
        }

        private static string Absolute(string path)
        {
            return Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Application.dataPath), path));
        }

        private static void PlayModeChanged(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredPlayMode || !SessionState.GetBool(KEY + "pending", false)) return;
            report = JsonUtility.FromJson<Report>(SessionState.GetString(KEY + "report", "{}"));
            currentStage = "play-mode-first-frames";
            firstFrame = Time.frameCount; phase = 0; finishing = false;
            EditorApplication.update -= Tick;
            EditorApplication.update += Tick;
        }

        private static void Tick()
        {
            if (finishing || !EditorApplication.isPlaying || Time.frameCount < firstFrame + 5 || (phase == 1 && Time.realtimeSinceStartup < captureNotBefore)) return;
            try
            {
                if (phase == 0)
                {
                    currentStage = "verify-play-runtime";
                    VerifyRuntime();
                    if (SessionState.GetBool(KEY + "render", false))
                    {
                        currentStage = "prepare-render";
                        PrepareRender(); phase = 1; firstFrame = Time.frameCount; captureNotBefore = Time.realtimeSinceStartup + 0.25f; currentStage = "render-wait"; return;
                    }
                }
                else { currentStage = "capture-render"; CaptureRender(); }
                Ensure(report.unexpectedErrorLogs == 0, "no-unexpected-unity-error-logs");
                Finish(true, "");
            }
            catch (Exception exception) { FailRun(exception); }
        }

        private static void VerifyRuntime()
        {
            report.playMode = EditorApplication.isPlaying;
            Ensure(report.playMode, "real-unity-play-mode-entered");
            PanelDocument document = ReadDocument();
            PanelController controller = UnityEngine.Object.FindObjectsByType<PanelController>(FindObjectsSortMode.None).Single(item => item.PanelId == document.panelId);
            instance = controller.gameObject;
            VerifyNoMissingScripts(instance);
            CheckPass("play-instance-has-no-missing-scripts");
            Dictionary<string, GameObject> nodes = NodeObjects(document, instance);
            VerifyGeometry(document, instance, false);
            Canvas.ForceUpdateCanvases();
            VerifyVisualStructure(document, nodes);

            PanelStateValue[] exported = controller.GetState();
            Ensure(exported.Length == document.fields.Length, "exported-state-shape-preserved");
            foreach (PanelField field in document.fields)
            {
                PanelStateValue value = exported.Single(item => item.fieldId == field.id);
                Assert(ValueEquals(value, field, false), "exported-current-value");
                if (!ValueEquals(value, field, true)) report.coverage.currentValuesDifferentFromInitial++;
            }
            CheckPass("current-state-preserved-separately-from-initial");
            string exportedJson = controller.GetStateJson();
            int events = 0;
            PanelHostEvent lastEvent = null;
            Action<PanelHostEvent> listener = value => { events++; lastEvent = value; };
            controller.EventRaised += listener;
            try
            {
                currentStage = "host-setters";
                foreach (PanelField field in document.fields) Assert(SetDifferent(controller, field), "host-setter-accepted");
                Ensure(events == 0, "host-state-setters-are-silent");
                Ensure(controller.SetState(exported) && controller.GetStateJson() == exportedJson, "complete-state-snapshot-round-trip");
                Ensure(events == 0, "complete-snapshot-is-silent");
                VerifyAtomicRejection(controller, document);
                foreach (PanelControl control in document.controls.Where(item => item.kind == "progress"))
                {
                    PanelField field = document.fields.Single(item => item.id == control.fieldId);
                    Image fill = nodes[control.nodeId].transform.Find(control.nodeId + ".__progress-fill").GetComponent<Image>();
                    Text label = nodes[control.valueTextId].GetComponent<Text>();
                    int before = events;
                    foreach (double value in new[] { 0d, field.max * 0.376123456789, field.max })
                    {
                        Assert(controller.SetProgress(field.id, value), "continuous-progress-update-accepted");
                        Assert(controller.GetState().Single(item => item.fieldId == field.id).numberValue == value, "continuous-progress-state-not-quantized");
                        Assert(Near(fill.fillAmount, (float)(value / field.max)), "native-image-fill-tracks-progress");
                        string wanted = (control.displayMode == "percent" ? value / field.max * 100 : value).ToString("F" + control.fractionDigits, System.Globalization.CultureInfo.InvariantCulture)
                            + (control.displayMode == "percent" ? "%" : "");
                        Assert(label.text == wanted, "native-progress-label-updates-in-place");
                    }
                    string current = controller.GetStateJson();
                    Assert(!controller.SetProgress(field.id, -1) && !controller.SetProgress(field.id, double.NaN) && controller.GetStateJson() == current, "invalid-progress-update-preserves-state");
                    ExecuteEvents.Execute(nodes[control.nodeId], new PointerEventData(EventSystem.current), ExecuteEvents.pointerClickHandler);
                    ExecuteEvents.Execute(nodes[control.nodeId], new BaseEventData(EventSystem.current), ExecuteEvents.submitHandler);
                    Assert(events == before && controller.GetStateJson() == current, "native-progress-is-readonly-and-silent");
                    report.coverage.progressBars++;
                }
                if (report.coverage.progressBars > 0) CheckPass("native-filled-image-progress-continuous-silent-readonly-and-label-update");
                Ensure(controller.SetState(exported), "progress-test-state-restored");
                foreach (PanelControl control in document.controls.Where(item => item.enabled && item.kind != "button"))
                {
                    currentStage = "native-" + control.kind + ":" + control.rowId;
                    PanelField field = document.fields.Single(item => item.id == control.fieldId);
                    int before = events;
                    if (control.kind == "select")
                    {
                        currentStage = "dropdown-show-hide:" + control.rowId;
                        VerifyNativeDropdown(nodes[control.nodeId].GetComponent<Dropdown>(), field);
                        Assert(events == before, "native-dropdown-open-close-is-not-value-change");
                        currentStage = "native-select:" + control.rowId;
                    }
                    ChangeNative(control, field, nodes[control.nodeId]);
                    Assert(events == before + 1 && lastEvent != null && lastEvent.Name == control.eventName && lastEvent.RowId == control.rowId
                        && lastEvent.FieldId == field.id && lastEvent.ValueType == field.type && lastEvent.StateJson == controller.GetStateJson(), "native-change-event-mapping");
                    PanelStateValue actual = controller.GetState().Single(item => item.fieldId == field.id);
                    if (field.type == "number") Assert(actual.numberValue == lastEvent.NumberValue, "native-slider-business-value");
                    else if (field.type == "boolean") Assert(actual.booleanValue == lastEvent.BooleanValue, "native-switch-business-value");
                    else Assert(actual.stringValue == lastEvent.StringValue && field.options.Any(option => option.id == actual.stringValue), "native-select-semantic-id");
                    if (control.kind == "slider") report.coverage.sliders++;
                    else if (control.kind == "switch") report.coverage.switches++;
                    else report.coverage.selects++;
                }
                if (document.controls.Any(item => item.enabled && item.kind != "button")) CheckPass("native-slider-toggle-dropdown-callbacks-map-to-business-state");

                foreach (PanelControl control in document.controls.Where(item => item.enabled && item.kind == "button"))
                {
                    currentStage = "button-prepare:" + control.rowId;
                    foreach (PanelField field in document.fields) Assert(SetAwayFromInitial(controller, field), "prepare-button-state");
                    PanelStateValue[] beforeState = controller.GetState();
                    int before = events;
                    PointerEventData pointer = new PointerEventData(EventSystem.current) { button = PointerEventData.InputButton.Left };
                    currentStage = "button-pointer:" + control.rowId;
                    ExecuteEvents.Execute(nodes[control.nodeId], pointer, ExecuteEvents.pointerClickHandler);
                    Assert(events == before + 1 && lastEvent != null && lastEvent.Name == control.eventName && lastEvent.Action == control.action, "native-button-pointer-event");
                    VerifyButtonState(control, document, beforeState, controller.GetState());
                    before = events;
                    currentStage = "button-submit:" + control.rowId;
                    ExecuteEvents.Execute(nodes[control.nodeId], new BaseEventData(EventSystem.current), ExecuteEvents.submitHandler);
                    Assert(events == before + 1 && lastEvent.Action == control.action, "native-button-submit-event");
                    report.coverage.buttons++;
                }
                if (report.coverage.buttons > 0) CheckPass("native-button-pointer-and-submit-preserve-action-and-reset-scope");

                for (int index = 0; index < 3; index++) { currentStage = "enable-disable-cycle:" + index; instance.SetActive(false); instance.SetActive(true); }
                PanelControl enabled = document.controls.FirstOrDefault(item => item.enabled);
                if (enabled != null)
                {
                    int before = events;
                    if (enabled.kind == "button") ExecuteEvents.Execute(nodes[enabled.nodeId], new BaseEventData(EventSystem.current), ExecuteEvents.submitHandler);
                    else ChangeNative(enabled, document.fields.Single(item => item.id == enabled.fieldId), nodes[enabled.nodeId]);
                    Ensure(events == before + 1, "three-real-enable-disable-cycles-have-one-owned-listener");
                }
                VerifyDisabledControls(document);
                VerifyScrollReveal(document, nodes);
                currentStage = "restore-fixture-state";
                Ensure(controller.SetState(exported) && controller.GetStateJson() == exportedJson, "fixture-state-restored-after-tests");
            }
            finally { controller.EventRaised -= listener; }
        }

        private static PanelDocument ReadDocument()
        {
            return JsonUtility.FromJson<PanelDocument>(File.ReadAllText(Absolute(SessionState.GetString(KEY + "kit", "") + "/panel.unity.json"), Encoding.UTF8));
        }

        private static Dictionary<string, GameObject> NodeObjects(PanelDocument document, GameObject root)
        {
            Transform[] children = root.GetComponentsInChildren<Transform>(true);
            Dictionary<string, GameObject> result = new Dictionary<string, GameObject>(StringComparer.Ordinal);
            foreach (PanelNode node in document.nodes)
            {
                Transform[] matches = children.Where(item => item.name == node.id).ToArray();
                Assert(matches.Length == 1, "stable-node-id-unique"); result.Add(node.id, matches[0].gameObject);
            }
            return result;
        }

        private static void VerifyGeometry(PanelDocument document, GameObject root, bool prefabAsset)
        {
            Dictionary<string, GameObject> objects = NodeObjects(document, root);
            foreach (PanelNode node in document.nodes)
            {
                RectTransform rect = objects[node.id].GetComponent<RectTransform>();
                Assert(rect != null, "native-rect-transform");
                if (node.parentId == "")
                {
                    CanvasScaler scaler = root.GetComponent<CanvasScaler>();
                    Assert(scaler != null && Near(scaler.referenceResolution.x, document.canvasWidth) && Near(scaler.referenceResolution.y, document.canvasHeight), "canvas-reference-resolution");
                    if (!prefabAsset)
                    {
                        Canvas canvas = root.GetComponent<Canvas>();
                        Vector3 scale = rect.lossyScale;
                        Assert(canvas != null && canvas.isActiveAndEnabled && root.GetComponent<GraphicRaycaster>() != null
                            && rect.rect.width > 0 && rect.rect.height > 0 && scale.x > 0 && scale.y > 0
                            && !float.IsInfinity(scale.x) && !float.IsInfinity(scale.y), "native-canvas-has-positive-renderable-geometry");
                    }
                    // Native Canvas owns its root rectangle; logical size is the scaler contract.
                    continue;
                }
                else
                {
                    PanelNode parent = document.nodes.Single(item => item.id == node.parentId);
                    Transform expected = parent.type == "ScrollView" ? objects[parent.id].GetComponent<ScrollRect>().content : objects[parent.id].transform;
                    Assert(rect.parent == expected, "native-node-parent");
                }
                Assert(Near(rect.anchoredPosition.x, node.x) && Near(rect.anchoredPosition.y, -node.y)
                    && Near(rect.sizeDelta.x, node.width) && Near(rect.sizeDelta.y, node.height), "native-node-local-geometry");
            }
            report.coverage.sourceNodes = document.nodes.Length;
            CheckPass(prefabAsset ? "prefab-every-source-node-geometry-and-parent" : "play-mode-every-source-node-geometry-and-parent");
        }

        private static void VerifyVisualStructure(PanelDocument document, Dictionary<string, GameObject> nodes)
        {
            foreach (PanelNode node in document.nodes)
            {
                GameObject current = nodes[node.id];
                if (node.type == "Text")
                {
                    Text text = current.GetComponent<Text>();
                    Assert(text != null && text.text == node.text && !text.supportRichText && text.font != null, "native-text-content");
                    report.coverage.textNodes++;
                    if (node.id.Contains(".row.") && node.id.EndsWith(".control", StringComparison.Ordinal))
                    {
                        Assert(!document.controls.Any(item => item.nodeId == node.id) && current.GetComponent<Selectable>() == null, "readonly-text-no-business-control");
                        report.coverage.readOnlyControls++;
                    }
                }
                else if (node.type == "ProgressBar")
                {
                    Image fill = current.transform.Find(node.id + ".__progress-fill").GetComponent<Image>();
                    Assert(current.GetComponent<Slider>() == null && current.GetComponent<Selectable>() == null && fill != null
                        && fill.sprite != null && fill.type == Image.Type.Filled && fill.fillMethod == Image.FillMethod.Horizontal
                        && !fill.raycastTarget && !current.GetComponent<Image>().raycastTarget, "native-progress-image-not-selectable");
                    Assert(fill.sprite.texture.width == 1 && fill.sprite.texture.height == 1, "native-progress-owned-flat-sprite");
                }
                else if (node.type == "ScrollView")
                {
                    ScrollRect scroll = current.GetComponent<ScrollRect>();
                    Assert(scroll != null && scroll.viewport != null && scroll.content != null && scroll.viewport.GetComponent<RectMask2D>() != null
                        && Near(scroll.content.rect.width, node.contentWidth) && Near(scroll.content.rect.height, node.contentHeight), "native-scroll-content-and-mask");
                    report.coverage.scrollViews++;
                }
                else if (node.type == "Image")
                {
                    Image image = current.GetComponentInChildren<Image>(true);
                    Assert(image != null && image.sprite != null && image.preserveAspect == (node.fit == "contain"), "native-sprite-reference");
                    PanelAsset asset = document.assets.Single(item => item.path == node.source);
                    Rect expected = node.hasRegion ? new Rect(node.regionX, asset.height - node.regionY - node.regionHeight, node.regionWidth, node.regionHeight)
                        : new Rect(0, 0, asset.width, asset.height);
                    Rect actual = image.sprite.rect;
                    Assert(Near(actual.x, expected.x) && Near(actual.y, expected.y) && Near(actual.width, expected.width) && Near(actual.height, expected.height), "native-sprite-region-y-flip");
                    report.coverage.images++;
                    if (node.hasRegion) report.coverage.spriteRegions++;
                }
                else if (node.type == "Slider")
                {
                    currentStage = "slider-thumb:" + node.id;
                    Slider slider = current.GetComponent<Slider>();
                    Assert(slider != null && slider.handleRect != null && Near(slider.handleRect.rect.width, 20) && Near(slider.handleRect.rect.height, 20), "native-slider-thumb-keeps-20-pixel-size");
                    report.coverage.sliderThumbs++;
                }
            }
            if (report.coverage.textNodes > 0) CheckPass("native-text-font-and-content");
            if (report.coverage.readOnlyControls > 0) CheckPass("readonly-text-has-no-binding-or-selectable");
            if (report.coverage.scrollViews > 0) CheckPass("native-scroll-content-and-viewport-mask");
            if (report.coverage.images > 0) CheckPass("native-image-contain-and-sprite-regions");
            if (report.coverage.spriteRegions > 0) CheckPass("source-top-left-regions-flip-to-unity-bottom-left");
            if (report.coverage.sliderThumbs > 0) CheckPass("native-slider-driven-thumb-keeps-20-pixel-size");
        }

        private static void VerifyNoMissingScripts(GameObject root)
        {
            foreach (Transform child in root.GetComponentsInChildren<Transform>(true)) Assert(GameObjectUtility.GetMonoBehavioursWithMissingScriptCount(child.gameObject) == 0, "missing-script");
        }

        private static bool ValueEquals(PanelStateValue value, PanelField field, bool initial)
        {
            return value.type == field.type && (field.type == "number" || field.type == "progress" ? value.numberValue == (initial ? field.initialNumber : field.numberValue)
                : field.type == "boolean" ? value.booleanValue == (initial ? field.initialBoolean : field.booleanValue)
                : value.stringValue == (initial ? field.initialString : field.stringValue));
        }

        private static bool ValuesEqual(PanelStateValue a, PanelStateValue b)
        {
            return a.type == b.type && (a.type == "number" || a.type == "progress" ? a.numberValue == b.numberValue : a.type == "boolean" ? a.booleanValue == b.booleanValue : a.stringValue == b.stringValue);
        }

        private static bool SetDifferent(PanelController controller, PanelField field)
        {
            PanelStateValue current = controller.GetState().Single(item => item.fieldId == field.id);
            if (field.type == "number") return controller.SetNumber(field.id, current.numberValue == field.min ? field.max : field.min);
            if (field.type == "progress") return controller.SetProgress(field.id, current.numberValue == 0 ? field.max : 0);
            if (field.type == "boolean") return controller.SetBoolean(field.id, !current.booleanValue);
            PanelOption other = field.options.FirstOrDefault(item => item.id != current.stringValue);
            return controller.SetChoice(field.id, other == null ? current.stringValue : other.id);
        }

        private static bool SetAwayFromInitial(PanelController controller, PanelField field)
        {
            if (field.type == "number") return controller.SetNumber(field.id, field.initialNumber == field.min ? field.max : field.min);
            if (field.type == "progress") return controller.SetProgress(field.id, field.initialNumber == 0 ? field.max : 0);
            if (field.type == "boolean") return controller.SetBoolean(field.id, !field.initialBoolean);
            PanelOption other = field.options.FirstOrDefault(item => item.id != field.initialString);
            return controller.SetChoice(field.id, other == null ? field.initialString : other.id);
        }

        private static void ChangeNative(PanelControl control, PanelField field, GameObject node)
        {
            if (control.kind == "slider")
            {
                Slider slider = node.GetComponent<Slider>();
                Assert(slider.wholeNumbers && Near(slider.minValue, 0) && Near(slider.maxValue, (float)Math.Round((field.max - field.min) / field.step)), "slider-integer-step-index");
                slider.value = slider.value == 0 ? slider.maxValue : 0;
            }
            else if (control.kind == "switch") { Toggle toggle = node.GetComponent<Toggle>(); toggle.isOn = !toggle.isOn; }
            else
            {
                Dropdown dropdown = node.GetComponent<Dropdown>();
                Assert(dropdown.options.Count > 1, "enum-fixture-needs-choice-change");
                dropdown.value = (dropdown.value + 1) % dropdown.options.Count;
            }
        }

        private static void VerifyNativeDropdown(Dropdown dropdown, PanelField field)
        {
            Assert(dropdown != null && dropdown.template != null && !dropdown.template.gameObject.activeSelf, "native-dropdown-template-ready");
            dropdown.Show();
            Canvas.ForceUpdateCanvases();
            Transform list = dropdown.transform.Find("Dropdown List");
            Assert(list != null && list.gameObject.activeInHierarchy && list.GetComponent<Canvas>() != null, "native-dropdown-created-overlay-list");
            Toggle[] options = list.GetComponentsInChildren<Toggle>(false);
            Assert(options.Length == field.options.Length, "native-dropdown-instantiated-option-count");
            foreach (PanelOption option in field.options)
                Assert(options.Any(item => item.GetComponentsInChildren<Text>(false).Any(text => text.text == option.label)), "native-dropdown-option-labels");
            dropdown.Hide();
            CheckPass("native-dropdown-template-expands-options-and-closes");
        }

        private static void VerifyAtomicRejection(PanelController controller, PanelDocument document)
        {
            if (document.fields.Length == 0) return;
            string before = controller.GetStateJson();
            PanelStateValue[] invalid = controller.GetState();
            PanelField first = document.fields.Single(item => item.id == invalid[0].fieldId);
            if (first.type == "number" || first.type == "progress") invalid[0].numberValue = invalid[0].numberValue == first.min ? first.max : first.min;
            else if (first.type == "boolean") invalid[0].booleanValue = !invalid[0].booleanValue;
            else invalid[0].stringValue = first.options.Last().id;
            invalid[invalid.Length - 1].fieldId = "__unknown_smoke_field";
            expectedErrors++;
            bool accepted;
            try { accepted = controller.SetState(invalid); }
            finally { expectedErrors--; }
            Ensure(!accepted && controller.GetStateJson() == before, "invalid-complete-snapshot-is-atomically-rejected");
            PanelField numeric = document.fields.FirstOrDefault(item => item.type == "number");
            if (numeric != null)
            {
                expectedErrors++;
                try { accepted = controller.SetNumber(numeric.id, double.NaN); }
                finally { expectedErrors--; }
                Ensure(!accepted && controller.GetStateJson() == before, "non-finite-number-is-rejected");
            }
        }

        private static void VerifyButtonState(PanelControl control, PanelDocument document, PanelStateValue[] before, PanelStateValue[] after)
        {
            foreach (PanelStateValue value in after)
            {
                if (control.action == "reset-initial" && control.resetFields.Contains(value.fieldId))
                {
                    Assert(ValueEquals(value, document.fields.Single(item => item.id == value.fieldId), true), "reset-restores-source-initial");
                    report.coverage.resetFields++;
                }
                else
                {
                    Assert(ValuesEqual(value, before.Single(item => item.fieldId == value.fieldId)), "button-preserves-unrelated-state");
                    if (control.action == "reset-initial") report.coverage.preservedResetFields++;
                }
            }
        }

        private static void VerifyDisabledControls(PanelDocument source)
        {
            if (source.controls.Length == 0) return;
            currentStage = "disabled-clone:instantiate";
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(SessionState.GetString(KEY + "prefab", ""));
            GameObject clone = UnityEngine.Object.Instantiate(prefab);
            // This additional test fixture gets Unity's '(Clone)' suffix; restore its declared
            // fixture name while retaining strict source-ID checks for the saved Prefab.
            clone.name = source.nodes.Single(item => item.parentId == "").id;
            try
            {
                PanelDocument disabled = JsonUtility.FromJson<PanelDocument>(JsonUtility.ToJson(source));
                foreach (PanelControl control in disabled.controls) control.enabled = false;
                Dictionary<string, GameObject> nodes = NodeObjects(disabled, clone);
                PanelControlView[] views = disabled.controls.Select(control => new PanelControlView { definition = control,
                    slider = nodes[control.nodeId].GetComponent<Slider>(), toggle = nodes[control.nodeId].GetComponent<Toggle>(),
                    dropdown = nodes[control.nodeId].GetComponent<Dropdown>(), button = nodes[control.nodeId].GetComponent<Button>(),
                    progressFill = control.kind == "progress" ? nodes[control.nodeId].transform.Find(control.nodeId + ".__progress-fill").GetComponent<Image>() : null,
                    valueText = string.IsNullOrEmpty(control.valueTextId) ? null : nodes[control.valueTextId].GetComponent<Text>() }).ToArray();
                PanelController controller = clone.GetComponent<PanelController>();
                currentStage = "disabled-clone:configure";
                Assert(controller.Configure(disabled, views), "disabled-fixture-configuration");
                int events = 0;
                controller.EventRaised += value => events++;
                string before = controller.GetStateJson();
                foreach (PanelControlView view in views)
                {
                    currentStage = "disabled-" + view.definition.kind + ":" + view.definition.rowId;
                    if (view.definition.kind == "button")
                    {
                        expectedErrors++;
                        try { view.button.onClick.Invoke(); }
                        finally { expectedErrors--; }
                    }
                    else if (view.definition.kind == "slider") view.slider.onValueChanged.Invoke(view.slider.value == 0 ? view.slider.maxValue : 0);
                    else if (view.definition.kind == "switch") view.toggle.onValueChanged.Invoke(!view.toggle.isOn);
                    else if (view.definition.kind == "select") view.dropdown.onValueChanged.Invoke((view.dropdown.value + 1) % view.dropdown.options.Count);
                    Assert(controller.GetStateJson() == before && events == 0, "disabled-user-callback-rejected");
                    report.coverage.disabledControls++;
                }
                CheckPass("disabled-native-control-callbacks-cannot-change-or-emit");
            }
            finally { currentStage = "disabled-clone:destroy"; UnityEngine.Object.DestroyImmediate(clone); }
        }

        private static void VerifyScrollReveal(PanelDocument document, Dictionary<string, GameObject> nodes)
        {
            int checkedScrolls = 0;
            foreach (PanelNode node in document.nodes.Where(item => item.type == "ScrollView" && item.contentHeight > item.height))
            {
                currentStage = "scroll-reveal:" + node.id;
                ScrollRect scroll = nodes[node.id].GetComponent<ScrollRect>();
                PanelScrollReveal[] targets = scroll.content.GetComponentsInChildren<PanelScrollReveal>(true);
                if (targets.Length == 0) continue;
                scroll.verticalNormalizedPosition = 1;
                Canvas.ForceUpdateCanvases();
                PanelScrollReveal bottom = targets.OrderBy(item => scroll.viewport.InverseTransformPoint(item.transform.position).y).First();
                ExecuteEvents.Execute(bottom.gameObject, new BaseEventData(EventSystem.current), ExecuteEvents.selectHandler);
                Canvas.ForceUpdateCanvases();
                Vector3[] corners = new Vector3[4];
                ((RectTransform)bottom.transform).GetWorldCorners(corners);
                float min = corners.Min(point => scroll.viewport.InverseTransformPoint(point).y);
                float max = corners.Max(point => scroll.viewport.InverseTransformPoint(point).y);
                Assert(min >= scroll.viewport.rect.yMin - 0.1f && max <= scroll.viewport.rect.yMax + 0.1f && scroll.content.anchoredPosition.y > 0, "keyboard-selection-reveals-bottom-control");
                scroll.verticalNormalizedPosition = 1;
                checkedScrolls++;
            }
            if (checkedScrolls > 0) CheckPass("native-select-event-reveals-bottom-scroll-control");
        }

        private static void PrepareRender()
        {
            PanelDocument document = ReadDocument();
            int width = Mathf.RoundToInt(document.canvasWidth), height = Mathf.RoundToInt(document.canvasHeight);
            renderTexture = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            renderTexture.Create();
            GameObject cameraObject = new GameObject("__SmokeRenderCamera", typeof(Camera));
            renderCamera = cameraObject.GetComponent<Camera>();
            renderCamera.clearFlags = CameraClearFlags.SolidColor;
            renderCamera.backgroundColor = new Color(0.4f, 0, 0.4f, 1);
            renderCamera.orthographic = true;
            renderCamera.orthographicSize = height * 0.5f;
            renderCamera.nearClipPlane = 0.1f; renderCamera.farClipPlane = 1000;
            renderCamera.targetTexture = renderTexture;
            Canvas canvas = instance.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceCamera;
            canvas.worldCamera = renderCamera;
            canvas.planeDistance = 100;
            CanvasScaler scaler = instance.GetComponent<CanvasScaler>();
            scaler.referenceResolution = new Vector2(width, height);
            Canvas.ForceUpdateCanvases();
            foreach (Text text in instance.GetComponentsInChildren<Text>(true))
            {
                text.cachedTextGenerator.Invalidate();
                text.SetAllDirty();
            }
            Canvas.ForceUpdateCanvases();
        }

        private static void CaptureRender()
        {
            Canvas.ForceUpdateCanvases();
            renderCamera.Render();
            VerifyVisibleTextMeshes();
            RenderTexture previous = RenderTexture.active;
            Texture2D image = new Texture2D(renderTexture.width, renderTexture.height, TextureFormat.RGBA32, false);
            try
            {
                RenderTexture.active = renderTexture;
                image.ReadPixels(new Rect(0, 0, image.width, image.height), 0, 0);
                image.Apply();
                Color32[] pixels = image.GetPixels32();
                HashSet<uint> colors = new HashSet<uint>();
                for (int index = 0; index < pixels.Length; index += Math.Max(1, pixels.Length / 20000))
                {
                    Color32 value = pixels[index];
                    colors.Add(((uint)value.r << 24) | ((uint)value.g << 16) | ((uint)value.b << 8) | value.a);
                }
                Ensure(colors.Count > 16, "native-camera-render-contains-ui-detail");
                string path = Absolute("../native-panel.png");
                Assert(!File.Exists(path), "native-render-new-file-required");
                File.WriteAllBytes(path, image.EncodeToPNG());
                RecordArtifact(path, "native-panel.png");
                report.rendered = true; report.screenshot = "native-panel.png";
                CheckPass("native-ui-png-written-no-pixel-identity-claim");
            }
            finally
            {
                RenderTexture.active = previous;
                UnityEngine.Object.DestroyImmediate(image);
                renderCamera.targetTexture = null;
                renderTexture.Release();
                UnityEngine.Object.DestroyImmediate(renderTexture);
            }
        }

        private static bool Near(float a, float b) { return Mathf.Abs(a - b) <= 0.01f; }

        private static void VerifyVisibleTextMeshes()
        {
            HashSet<string> rowIds = new HashSet<string>(ReadDocument().nodes.Where(node => node.type == "Container" && node.id.Contains(".row.")).Select(node => node.id), StringComparer.Ordinal);
            foreach (Text text in instance.GetComponentsInChildren<Text>(false))
            {
                if (string.IsNullOrWhiteSpace(text.text) || text.canvasRenderer.cull) continue;
                currentStage = "render-text:" + text.gameObject.name;
                TextGenerator generator = text.cachedTextGenerator;
                Assert(generator.vertexCount >= 4 && generator.characterCountVisible > 0 && text.color.a > 0, "visible-text-generates-glyph-mesh");
                RectTransform row = null;
                for (Transform ancestor = text.transform.parent; ancestor != null; ancestor = ancestor.parent)
                    if (rowIds.Contains(ancestor.name)) { row = ancestor as RectTransform; break; }
                IList<UIVertex> vertices = generator.verts;
                int realGlyphs = 0;
                for (int first = 0; first + 3 < vertices.Count; first += 4)
                {
                    float left = float.PositiveInfinity, right = float.NegativeInfinity, low = float.PositiveInfinity, high = float.NegativeInfinity;
                    for (int offset = 0; offset < 4; offset++)
                    {
                        Vector3 vertex = vertices[first + offset].position;
                        left = Mathf.Min(left, vertex.x); right = Mathf.Max(right, vertex.x);
                        low = Mathf.Min(low, vertex.y); high = Mathf.Max(high, vertex.y);
                    }
                    if (right <= left || high <= low) continue;
                    realGlyphs++;
                    if (row == null) continue;
                    for (int offset = 0; offset < 4; offset++)
                    {
                        Vector3 local = row.InverseTransformPoint(text.transform.TransformPoint(vertices[first + offset].position / text.pixelsPerUnit));
                        Assert(local.x >= row.rect.xMin - 2 && local.x <= row.rect.xMax + 2 && local.y >= row.rect.yMin - 2 && local.y <= row.rect.yMax + 2, "visible-glyphs-fit-containing-row");
                    }
                }
                Assert(realGlyphs > 0, "visible-text-has-nondegenerate-glyph-quads");
                report.coverage.visibleTextMeshes++;
            }
            Assert(report.coverage.visibleTextMeshes > 0, "render-has-visible-text-meshes");
            CheckPass("visible-native-text-produces-real-glyph-meshes");
            currentStage = "capture-render";
        }
        private static void Assert(bool condition, string code) { if (!condition) throw new InvalidOperationException("PANEL_SMOKE_" + code); }
        private static void Ensure(bool condition, string name) { Assert(condition, name); CheckPass(name); }
        private static void CheckPass(string name) { report.checks.Add(new Check { name = name }); }

        private static void RecordArtifact(string fullPath, string relativePath)
        {
            Assert(!Path.IsPathRooted(relativePath) && !relativePath.Contains("..") && !relativePath.Contains("\\"), "artifact-relative-path");
            string digest;
            long size;
            using (FileStream stream = File.OpenRead(fullPath))
            using (SHA256 sha = SHA256.Create())
            {
                size = stream.Length;
                digest = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            }
            report.artifacts.Add(new Artifact { path = relativePath, bytes = size, sha256 = digest });
        }

        private static void Logged(string message, string trace, LogType type)
        {
            if (report == null || finishing || reportingFailure || (type != LogType.Error && type != LogType.Exception && type != LogType.Assert)) return;
            if (expectedErrors > 0) report.expectedErrorLogs++;
            else
            {
                report.unexpectedErrorLogs++;
                if (report.unexpectedLogMessages.Count < 10) report.unexpectedLogMessages.Add(SanitizeLogMessage(type + ": " + message));
                if (report.unexpectedLogDetails.Count < 10) report.unexpectedLogDetails.Add(new LogDetail { stage = SanitizeLogMessage(currentStage),
                    message = SanitizeLogMessage(type + ": " + message), stackTrace = SanitizeStackTrace(trace) });
                if (SessionState.GetBool(KEY + "waitingForEditor", false)) SessionState.SetString(KEY + "report", JsonUtility.ToJson(report));
            }
        }

        private static string SanitizeStackTrace(string trace)
        {
            StringBuilder result = new StringBuilder();
            foreach (string line in (trace ?? "").Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (result.Length >= 1000) break;
                string safeLine = SanitizeLogMessage(line);
                int remaining = 1000 - result.Length;
                result.Append(safeLine.Length > remaining ? safeLine.Substring(0, remaining) : safeLine);
                if (result.Length < 1000) result.Append('\n');
            }
            return result.ToString();
        }

        private static string SanitizeLogMessage(string message)
        {
            string firstLine = (message ?? "").Split(new[] { '\r', '\n' }, StringSplitOptions.None)[0];
            firstLine = Regex.Replace(firstLine, @"[A-Za-z][A-Za-z0-9+.-]*://\S+", "[url]");
            firstLine = Regex.Replace(firstLine, @"[A-Za-z]:[\\/][^\r\n]*", "[path]");
            firstLine = Regex.Replace(firstLine, @"\\\\[^\r\n]*", "[path]");
            firstLine = Regex.Replace(firstLine, @"\b(?:Assets|Packages|Library|Temp|ProjectSettings)[\\/][^\r\n]*", "[project-path]");
            firstLine = Regex.Replace(firstLine, @"(?<![\w:])/(?:[^\s/]+/)*[^\s/]*", "[path]");
            firstLine = new string(firstLine.Select(character => char.IsControl(character) ? ' ' : character).ToArray());
            return firstLine.Length > 300 ? firstLine.Substring(0, 300) : firstLine;
        }

        private static void FailRun(Exception exception)
        {
            reportingFailure = true;
            try { Debug.LogException(exception); }
            finally { reportingFailure = false; }
            Finish(false, SafeError(exception));
        }

        private static string SafeError(Exception exception)
        {
            // Reports carry stable failure codes; detailed local Editor logs stay outside the kit.
            string message = exception.Message ?? "";
            if (message.StartsWith("PANEL_", StringComparison.Ordinal) && message.All(character => char.IsLetterOrDigit(character) || character == '_' || character == '-')) return message;
            return "PANEL_SMOKE_" + exception.GetType().Name;
        }

        private static void Finish(bool success, string error)
        {
            if (finishing) return;
            finishing = true;
            EditorApplication.update -= Tick;
            EditorApplication.update -= WaitForEditorStartup;
            SessionState.SetBool(KEY + "waitingForEditor", false);
            SessionState.SetBool(KEY + "pending", false);
            if (report == null) report = new Report();
            report.status = success ? "PASS" : "FAIL"; report.error = error;
            report.failureStage = success ? "" : SanitizeLogMessage(currentStage);
            string path = SessionState.GetString(KEY + "reportPath", Absolute("../unity-smoke.json"));
            try { File.WriteAllText(path, JsonUtility.ToJson(report, true) + "\n", new UTF8Encoding(false)); }
            catch (Exception) { success = false; }
            EditorApplication.Exit(success ? 0 : 1);
        }
    }
}
#endif
