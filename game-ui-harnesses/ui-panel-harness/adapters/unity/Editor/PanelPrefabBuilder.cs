#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace GameUi.PanelHarness.Editor
{
    /// <summary>Imports one bounded local document into a new Assets folder. Never edits an open scene.</summary>
    public static class PanelPrefabBuilder
    {
        private static readonly Regex ID = new Regex("^[A-Za-z0-9][A-Za-z0-9_.-]{0,239}\\z", RegexOptions.CultureInvariant);
        private static readonly Regex SHA = new Regex("^[a-f0-9]{64}\\z", RegexOptions.CultureInvariant);
        private static readonly Regex COLOR = new Regex("^#[a-fA-F0-9]{6}\\z", RegexOptions.CultureInvariant);
        private static readonly string[] RUNTIME_FILES = { "PanelDocument.cs", "PanelControlView.cs", "PanelController.cs", "PanelRoundedGraphic.cs", "PanelScrollReveal.cs" };
        private const int MAX_JSON_BYTES = 4 * 1024 * 1024;
        private const int MAX_IMAGE_BYTES = 1024 * 1024;
        private const int MAX_FONT_BYTES = 64 * 1024 * 1024;

        private sealed class ImportData
        {
            internal PanelDocument document;
            internal string runtimeSha256;
            internal readonly Dictionary<string, byte[]> images = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        }

        [Serializable] private sealed class RuntimeIdentity { public string adapterVersion, runtimeSha256; }
        [Serializable] private sealed class PanelIdentity
        {
            public string identityVersion = "0.1", panelId, panelSha256, previousPanelSha256, adapterVersion, runtimeSha256, prefabGuid, prefabSha256;
            public int revision;
        }

        public static string GetIdentityJson(string prefabAssetPath)
        {
            return JsonUtility.ToJson(ReadIdentity(prefabAssetPath));
        }

        private static string RuntimeFolder()
        {
            string[] paths = AssetDatabase.FindAssets("PanelController t:MonoScript").Select(AssetDatabase.GUIDToAssetPath)
                .Where(path => { MonoScript script = AssetDatabase.LoadAssetAtPath<MonoScript>(path); return script != null && script.GetClass() == typeof(PanelController); }).ToArray();
            if (paths.Length != 1 || !paths[0].StartsWith("Assets/", StringComparison.Ordinal)) throw new InvalidOperationException("PANEL_RUNTIME_SINGLE_PROJECT_SCRIPT_REQUIRED");
            string folder = Path.GetDirectoryName(paths[0]).Replace('\\', '/');
            if (!folder.EndsWith("/Runtime", StringComparison.Ordinal)) throw new InvalidOperationException("PANEL_RUNTIME_FOLDER_REQUIRED");
            return folder;
        }

        private static string RuntimeHash()
        {
            string folder = RuntimeFolder();
            StringBuilder entries = new StringBuilder();
            foreach (string name in RUNTIME_FILES.OrderBy(value => value, StringComparer.Ordinal))
            {
                string path = ToAbsoluteAssetPath(folder + "/" + name);
                AssertNoLinks(path);
                entries.Append(name).Append(':').Append(Hash(File.ReadAllBytes(path))).Append('\n');
            }
            return Hash(Encoding.UTF8.GetBytes(entries.ToString()));
        }

        private static string IdentityPath(string prefabPath) { return Path.GetDirectoryName(prefabPath).Replace('\\', '/') + "/panel-identity.json"; }

        private static PanelIdentity ReadIdentity(string prefabPath)
        {
            string path = ToAbsoluteAssetPath(IdentityPath(prefabPath));
            AssertNoLinks(path);
            if (!File.Exists(path) || new FileInfo(path).Length > 8192) throw new InvalidDataException("PANEL_IDENTITY_REQUIRED");
            PanelIdentity identity = JsonUtility.FromJson<PanelIdentity>(new UTF8Encoding(false, true).GetString(File.ReadAllBytes(path)));
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            PanelController controller = prefab == null ? null : prefab.GetComponent<PanelController>();
            if (identity == null || identity.identityVersion != "0.1" || identity.revision < 1 || identity.revision > 1000000
                || controller == null || identity.panelId != controller.PanelId || identity.panelSha256 != controller.PanelSha256
                || !IsSha(identity.panelSha256) || !IsSha(identity.runtimeSha256) || identity.prefabGuid != AssetDatabase.AssetPathToGUID(prefabPath)) throw new InvalidDataException("PANEL_IDENTITY_MISMATCH");
            if (!IsSha(identity.prefabSha256) || identity.prefabSha256 != Hash(File.ReadAllBytes(ToAbsoluteAssetPath(prefabPath)))) throw new InvalidDataException("PANEL_IDENTITY_PREFAB_CHANGED");
            return identity;
        }

        private static void WriteIdentity(string prefabPath, PanelIdentity identity)
        {
            string assetPath = IdentityPath(prefabPath), path = ToAbsoluteAssetPath(assetPath);
            string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temporary, JsonUtility.ToJson(identity, true) + "\n", new UTF8Encoding(false));
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
                AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        private static Dictionary<string, long> ObjectIdentifiers(GameObject prefab)
        {
            Dictionary<string, long> identifiers = new Dictionary<string, long>(StringComparer.Ordinal);
            HashSet<string> names = new HashSet<string>(StringComparer.Ordinal);
            foreach (Transform transform in prefab.GetComponentsInChildren<Transform>(true))
            {
                if (!names.Add(transform.name)) throw new InvalidDataException("PANEL_UPDATE_UNIQUE_OBJECT_NAMES_REQUIRED");
                List<UnityEngine.Object> objects = new List<UnityEngine.Object> { transform.gameObject };
                objects.AddRange(transform.GetComponents<Component>());
                foreach (UnityEngine.Object value in objects)
                {
                    if (value == null) throw new InvalidDataException("PANEL_UPDATE_MISSING_SCRIPT");
                    string key = transform.name + ":" + value.GetType().FullName;
                    string guid; long localId;
                    if (identifiers.ContainsKey(key) || !AssetDatabase.TryGetGUIDAndLocalFileIdentifier(value, out guid, out localId)) throw new InvalidDataException("PANEL_UPDATE_OBJECT_ID_REQUIRED");
                    identifiers.Add(key, localId);
                }
            }
            return identifiers;
        }

        public static string Build(string documentPath, string outputAssetFolder, Font font)
        {
            return BuildOrUpdate(documentPath, outputAssetFolder, font, null);
        }

        public static string Update(string documentPath, string prefabAssetPath, Font font, string expectedPanelSha256)
        {
            if (!IsSha(expectedPanelSha256)) throw new ArgumentException("PANEL_UPDATE_BASE_HASH_REQUIRED");
            PanelIdentity identity = ReadIdentity(prefabAssetPath);
            if (identity.panelSha256 != expectedPanelSha256) throw new InvalidOperationException("PANEL_UPDATE_STALE_BASE");
            string folder = Path.GetDirectoryName(prefabAssetPath).Replace('\\', '/');
            return BuildOrUpdate(documentPath, folder, font, identity);
        }

        private static string BuildOrUpdate(string documentPath, string outputAssetFolder, Font font, PanelIdentity previous)
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("PANEL_IMPORT_PLAY_MODE");
            string outputPath = previous == null ? ValidateNewAssetFolder(outputAssetFolder) : ToAbsoluteAssetPath(outputAssetFolder);
            AssertNoLinks(outputPath);
            if (font == null || !EditorUtility.IsPersistent(font)) throw new ArgumentException("PANEL_IMPORT_PERSISTENT_FONT_REQUIRED");
            string fontPath = AssetDatabase.GetAssetPath(font);
            if (!fontPath.StartsWith("Assets/", StringComparison.Ordinal)) throw new ArgumentException("PANEL_IMPORT_FONT_MUST_BE_PROJECT_ASSET");
            string fontSource = ToAbsoluteAssetPath(fontPath);
            AssertNoLinks(fontSource);
            string fontExtension = Path.GetExtension(fontPath).ToLowerInvariant();
            if (fontExtension != ".ttf" && fontExtension != ".otf") throw new ArgumentException("PANEL_IMPORT_FONT_FILE_REQUIRED");
            if (!File.Exists(fontSource) || new FileInfo(fontSource).Length < 1 || new FileInfo(fontSource).Length > MAX_FONT_BYTES) throw new InvalidDataException("PANEL_IMPORT_FONT_SIZE");
            string fontSha256 = Hash(File.ReadAllBytes(fontSource));
            ImportData data = ReadAndValidate(documentPath);
            PanelDocument document = data.document;
            string runtimeFolder = RuntimeFolder();
            string expectedFolder = runtimeFolder.Substring(0, runtimeFolder.Length - "/Runtime".Length) + "/Panels/" + document.panelId;
            if (outputAssetFolder != expectedFolder) throw new ArgumentException("PANEL_IMPORT_PANEL_ID_FOLDER_REQUIRED");
            string prefabPath = outputAssetFolder + "/" + document.nodes[0].id + ".prefab";
            Dictionary<string, long> previousIds = null;
            byte[] oldPrefab = null, oldMeta = null, oldIdentity = null;
            if (previous != null)
            {
                if (previous.panelId != document.panelId || previous.prefabGuid != AssetDatabase.AssetPathToGUID(prefabPath)) throw new InvalidOperationException("PANEL_UPDATE_PANEL_ID_MISMATCH");
                if (previous.adapterVersion != PanelController.ADAPTER_VERSION || previous.runtimeSha256 != data.runtimeSha256) throw new InvalidOperationException("PANEL_UPDATE_RUNTIME_VERSION_MISMATCH");
                if (previous.revision >= 1000000) throw new InvalidOperationException("PANEL_UPDATE_REVISION_LIMIT");
                previousIds = ObjectIdentifiers(AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath));
                oldPrefab = File.ReadAllBytes(ToAbsoluteAssetPath(prefabPath));
                oldMeta = File.ReadAllBytes(ToAbsoluteAssetPath(prefabPath) + ".meta");
                oldIdentity = File.ReadAllBytes(ToAbsoluteAssetPath(IdentityPath(prefabPath)));
            }
            Scene previewScene = default(Scene);
            GameObject root = null;
            // Every source byte is validated before creating the new folder. A failed build leaves
            // its bounded folder for diagnosis; it cannot overwrite or delete another import.
            if (previous == null)
            {
                Directory.CreateDirectory(outputPath);
                AssetDatabase.ImportAsset(outputAssetFolder, ImportAssetOptions.ForceSynchronousImport);
            }
            bool committed = false, prefabWritten = false;
            try
            {
                // Keep native packages self-contained, including a font supplied elsewhere
                // in the host project. CopyAsset preserves its importer settings and source.
                string fontFolder = outputAssetFolder + "/Fonts";
                if (!AssetDatabase.IsValidFolder(fontFolder)) AssetDatabase.CreateFolder(outputAssetFolder, "Fonts");
                string copiedFontPath = fontFolder + "/" + fontSha256 + fontExtension;
                AssertNoLinks(ToAbsoluteAssetPath(copiedFontPath));
                if (!File.Exists(ToAbsoluteAssetPath(copiedFontPath)) && !AssetDatabase.CopyAsset(fontPath, copiedFontPath)) throw new IOException("PANEL_IMPORT_FONT_COPY_FAILED");
                AssetDatabase.ImportAsset(copiedFontPath, ImportAssetOptions.ForceSynchronousImport);
                font = AssetDatabase.LoadAssetAtPath<Font>(copiedFontPath);
                if (font == null || Hash(File.ReadAllBytes(ToAbsoluteAssetPath(copiedFontPath))) != fontSha256) throw new IOException("PANEL_IMPORT_FONT_COPY_INTEGRITY");
                Dictionary<string, Texture2D> textures = ImportTextures(data, outputAssetFolder);
                Dictionary<string, Sprite> sprites = new Dictionary<string, Sprite>(StringComparer.Ordinal);
                Dictionary<string, GameObject> objects = new Dictionary<string, GameObject>(StringComparer.Ordinal);
                Dictionary<string, Transform> parents = new Dictionary<string, Transform>(StringComparer.Ordinal);
                Dictionary<string, PanelControl> controls = document.controls.ToDictionary(value => value.nodeId, StringComparer.Ordinal);
                Dictionary<string, PanelField> fields = document.fields.ToDictionary(value => value.id, StringComparer.Ordinal);
                List<PanelControlView> views = new List<PanelControlView>();
                previewScene = EditorSceneManager.NewPreviewScene();
                foreach (PanelNode node in document.nodes)
                {
                    GameObject current = new GameObject(node.id, typeof(RectTransform));
                    if (root == null)
                    {
                        root = current;
                        SceneManager.MoveGameObjectToScene(root, previewScene);
                        root.SetActive(false);
                        Canvas canvas = root.AddComponent<Canvas>();
                        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
                        CanvasScaler scaler = root.AddComponent<CanvasScaler>();
                        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
                        scaler.referenceResolution = new Vector2(document.canvasWidth, document.canvasHeight);
                        scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
                        scaler.matchWidthOrHeight = 0.5f;
                        root.AddComponent<GraphicRaycaster>();
                    }
                    else current.transform.SetParent(parents[node.parentId], false);
                    SetRect((RectTransform)current.transform, node.x, node.y, node.width, node.height);
                    objects.Add(node.id, current);
                    parents.Add(node.id, current.transform);
                    PanelControl definition;
                    controls.TryGetValue(node.id, out definition);
                    PanelControlView view = definition == null ? null : new PanelControlView { definition = definition };
                    switch (node.type)
                    {
                        case "Container":
                            if (node.drawBackground) AddBackground(current, node);
                            break;
                        case "Text":
                            AddText(current, node.text, node, font, TextAnchor.MiddleLeft);
                            break;
                        case "Image":
                            AddImage(current, node, textures, sprites, outputAssetFolder);
                            break;
                        case "Slider":
                            BuildSlider(current, node, view);
                            break;
                        case "ProgressBar":
                            BuildProgress(current, node, view, outputAssetFolder);
                            break;
                        case "Switch":
                            BuildToggle(current, node, view);
                            break;
                        case "Select":
                            BuildDropdown(current, node, view, fields[definition.fieldId], font);
                            break;
                        case "Input":
                            BuildInput(current, node, view, fields[definition.fieldId], font);
                            break;
                        case "Button":
                            BuildButton(current, node, view, font);
                            break;
                        case "Tabs":
                            BuildTabs(current, node, view, fields[definition.fieldId], font);
                            break;
                        case "ScrollView":
                            parents[node.id] = BuildScroll(current, node);
                            break;
                    }
                    if (view != null) views.Add(view);
                }
                foreach (PanelControlView view in views)
                {
                    if (!string.IsNullOrEmpty(view.definition.valueTextId)) view.valueText = objects[view.definition.valueTextId].GetComponent<Text>();
                    if (view.definition.kind == "input")
                    {
                        view.requiredErrorText = objects[view.definition.requiredErrorTextId].GetComponent<Text>();
                        view.minLengthErrorText = objects[view.definition.minLengthErrorTextId].GetComponent<Text>();
                    }
                    if (view.definition.kind == "tabs") view.tabPages = view.definition.contentIds.Select(id => objects[id]).ToArray();
                    GameObject control = objects[view.definition.nodeId];
                    ScrollRect scroll = control.GetComponentInParent<ScrollRect>(true);
                    if (scroll != null) control.AddComponent<PanelScrollReveal>().Configure(scroll);
                }
                PanelController controller = root.AddComponent<PanelController>();
                if (!controller.Configure(document, views.ToArray())) throw new InvalidDataException("PANEL_IMPORT_CONTROLLER: " + controller.LastError);
                root.SetActive(true);
                // Unity names the Prefab root after the asset filename on save.
                if (root.GetComponentsInChildren<Transform>(true).Select(value => value.name).Distinct(StringComparer.Ordinal).Count() != root.GetComponentsInChildren<Transform>(true).Length) throw new InvalidDataException("PANEL_IMPORT_UNIQUE_OBJECT_NAMES_REQUIRED");
                bool success;
                prefabWritten = true;
                PrefabUtility.SaveAsPrefabAsset(root, prefabPath, out success);
                if (!success || AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath) == null) throw new IOException("PANEL_IMPORT_PREFAB_SAVE_FAILED");
                if (previous != null)
                {
                    if (AssetDatabase.AssetPathToGUID(prefabPath) != previous.prefabGuid) throw new IOException("PANEL_UPDATE_PREFAB_GUID_CHANGED");
                    Dictionary<string, long> nextIds = ObjectIdentifiers(AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath));
                    if (previousIds.Any(pair => nextIds.ContainsKey(pair.Key) && nextIds[pair.Key] != pair.Value)) throw new IOException("PANEL_UPDATE_OBJECT_ID_CHANGED");
                }
                WriteIdentity(prefabPath, new PanelIdentity { panelId = document.panelId, panelSha256 = document.panelSha256,
                    previousPanelSha256 = previous == null ? "" : previous.panelSha256, revision = previous == null ? 1 : previous.revision + 1,
                    adapterVersion = PanelController.ADAPTER_VERSION, runtimeSha256 = data.runtimeSha256, prefabGuid = AssetDatabase.AssetPathToGUID(prefabPath),
                    prefabSha256 = Hash(File.ReadAllBytes(ToAbsoluteAssetPath(prefabPath))) });
                committed = true;
                return prefabPath;
            }
            finally
            {
                if (previewScene.IsValid()) EditorSceneManager.ClosePreviewScene(previewScene);
                else if (root != null) UnityEngine.Object.DestroyImmediate(root);
                if (!committed && prefabWritten && previous != null)
                {
                    File.WriteAllBytes(ToAbsoluteAssetPath(prefabPath), oldPrefab);
                    File.WriteAllBytes(ToAbsoluteAssetPath(prefabPath) + ".meta", oldMeta);
                    File.WriteAllBytes(ToAbsoluteAssetPath(IdentityPath(prefabPath)), oldIdentity);
                    AssetDatabase.ImportAsset(prefabPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
                    AssetDatabase.ImportAsset(IdentityPath(prefabPath), ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
                }
            }
        }

        public static void ExportPackage(string prefabAssetPath, string packagePath)
        {
            if (string.IsNullOrEmpty(prefabAssetPath) || !prefabAssetPath.StartsWith("Assets/", StringComparison.Ordinal) || !prefabAssetPath.EndsWith(".prefab", StringComparison.Ordinal)) throw new ArgumentException("PANEL_EXPORT_PREFAB_PATH");
            AssertNoLinks(ToAbsoluteAssetPath(prefabAssetPath));
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabAssetPath);
            PanelController controller = prefab == null ? null : prefab.GetComponent<PanelController>();
            if (controller == null) throw new ArgumentException("PANEL_EXPORT_CONTROLLER_REQUIRED");
            if (string.IsNullOrEmpty(packagePath) || !Path.IsPathRooted(packagePath) || !packagePath.EndsWith(".unitypackage", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("PANEL_EXPORT_PACKAGE_PATH");
            string fullPackagePath = Path.GetFullPath(packagePath);
            if (!Directory.Exists(Path.GetDirectoryName(fullPackagePath)) || File.Exists(fullPackagePath) || Directory.Exists(fullPackagePath)) throw new IOException("PANEL_EXPORT_NEW_FILE_REQUIRED");
            AssertNoLinks(fullPackagePath);
            HashSet<string> paths = new HashSet<string>(AssetDatabase.GetDependencies(prefabAssetPath, true).Where(path => path.StartsWith("Assets/", StringComparison.Ordinal)), StringComparer.Ordinal);
            paths.Add(IdentityPath(prefabAssetPath));
            string scriptPath = AssetDatabase.GetAssetPath(MonoScript.FromMonoBehaviour(controller));
            string runtimeFolder = Path.GetDirectoryName(scriptPath).Replace('\\', '/');
            if (!runtimeFolder.StartsWith("Assets/", StringComparison.Ordinal) || !runtimeFolder.EndsWith("/Runtime", StringComparison.Ordinal)) throw new InvalidOperationException("PANEL_EXPORT_RUNTIME_MUST_BE_PROJECT_ASSETS");
            string adapterRoot = runtimeFolder.Substring(0, runtimeFolder.Length - "/Runtime".Length);
            if (!prefabAssetPath.StartsWith(adapterRoot + "/Panels/", StringComparison.Ordinal)) throw new ArgumentException("PANEL_EXPORT_PREFAB_OUTSIDE_ADAPTER_ROOT");
            foreach (string name in RUNTIME_FILES)
            {
                string path = runtimeFolder + "/" + name;
                if (AssetDatabase.LoadAssetAtPath<MonoScript>(path) == null) throw new FileNotFoundException("PANEL_EXPORT_RUNTIME_FILE: " + name);
                paths.Add(path);
            }
            foreach (string path in paths)
            {
                if (!path.StartsWith(adapterRoot + "/", StringComparison.Ordinal)) throw new InvalidOperationException("PANEL_EXPORT_DEPENDENCY_OUTSIDE_ADAPTER_ROOT");
                AssertNoLinks(ToAbsoluteAssetPath(path));
            }
            PanelIdentity identity = ReadIdentity(prefabAssetPath);
            if (identity.adapterVersion != PanelController.ADAPTER_VERSION || identity.runtimeSha256 != RuntimeHash()) throw new InvalidOperationException("PANEL_EXPORT_RUNTIME_VERSION_MISMATCH");
            // The exact dependency list avoids exporting unrelated project content.
            string temporary = fullPackagePath + "." + Guid.NewGuid().ToString("N") + ".unitypackage";
            try
            {
                AssetDatabase.ExportPackage(paths.OrderBy(path => path, StringComparer.Ordinal).ToArray(), temporary, ExportPackageOptions.Default);
                if (!File.Exists(temporary) || new FileInfo(temporary).Length == 0) throw new IOException("PANEL_EXPORT_PACKAGE_FAILED");
                // Move has no overwrite option, preserving a file created by another caller meanwhile.
                File.Move(temporary, fullPackagePath);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        private static ImportData ReadAndValidate(string documentPath)
        {
            if (string.IsNullOrEmpty(documentPath) || !Path.IsPathRooted(documentPath)) throw new ArgumentException("PANEL_IMPORT_ABSOLUTE_DOCUMENT_PATH_REQUIRED");
            string sourcePath = Path.GetFullPath(documentPath);
            AssertNoLinks(sourcePath);
            if (!File.Exists(sourcePath) || new FileInfo(sourcePath).Length > MAX_JSON_BYTES) throw new InvalidDataException("PANEL_IMPORT_DOCUMENT_SIZE");
            string json = new UTF8Encoding(false, true).GetString(File.ReadAllBytes(sourcePath));
            PanelDocument document = JsonUtility.FromJson<PanelDocument>(json.TrimStart('\uFEFF'));
            ValidateDocument(document);
            ImportData result = new ImportData { document = document };
            string sourceFolder = Path.GetDirectoryName(sourcePath);
            string identityPath = Path.Combine(sourceFolder, "unity-runtime.json");
            AssertNoLinks(identityPath);
            if (!File.Exists(identityPath) || new FileInfo(identityPath).Length > 8192) throw new InvalidDataException("PANEL_IMPORT_RUNTIME_IDENTITY_REQUIRED");
            RuntimeIdentity runtimeIdentity = JsonUtility.FromJson<RuntimeIdentity>(new UTF8Encoding(false, true).GetString(File.ReadAllBytes(identityPath)));
            result.runtimeSha256 = RuntimeHash();
            if (runtimeIdentity == null || runtimeIdentity.adapterVersion != PanelController.ADAPTER_VERSION || runtimeIdentity.runtimeSha256 != result.runtimeSha256) throw new InvalidDataException("PANEL_IMPORT_RUNTIME_IDENTITY_MISMATCH");
            long total = 0;
            foreach (PanelAsset asset in document.assets)
            {
                string source = Path.GetFullPath(Path.Combine(sourceFolder, asset.path.Replace('/', Path.DirectorySeparatorChar)));
                AssertNoLinks(source);
                if (!File.Exists(source) || new FileInfo(source).Length != asset.bytes) throw new InvalidDataException("PANEL_IMPORT_IMAGE_BYTES");
                byte[] bytes = File.ReadAllBytes(source);
                total += bytes.LongLength;
                if (total > MAX_IMAGE_BYTES || Hash(bytes) != asset.sha256 || bytes.Length < 45) throw new InvalidDataException("PANEL_IMPORT_IMAGE_HASH");
                byte[] signature = { 137, 80, 78, 71, 13, 10, 26, 10 };
                if (!signature.SequenceEqual(bytes.Take(8)) || ReadBigEndian(bytes, 8) != 13 || Encoding.ASCII.GetString(bytes, 12, 4) != "IHDR" || ReadBigEndian(bytes, 16) != asset.width || ReadBigEndian(bytes, 20) != asset.height) throw new InvalidDataException("PANEL_IMPORT_PNG_HEADER");
                result.images.Add(asset.path, bytes);
            }
            return result;
        }

        private static void ValidateDocument(PanelDocument document)
        {
            if (document == null || document.formatVersion != "0.1" || document.adapterVersion != PanelController.ADAPTER_VERSION || !new[] { "0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7" }.Contains(document.panelSpecVersion) || !ValidId(document.panelId) || !IsSha(document.panelSha256)) throw new InvalidDataException("PANEL_IMPORT_DOCUMENT_VERSION");
            if (!Positive(document.canvasWidth, 4096) || !Positive(document.canvasHeight, 4096) || document.nodes == null || document.nodes.Length < 1 || document.nodes.Length > 2048 || document.fields == null || document.fields.Length > 128 || document.controls == null || document.controls.Length > 128 || document.assets == null || document.assets.Length > 129) throw new InvalidDataException("PANEL_IMPORT_DOCUMENT_LIMIT");
            Dictionary<string, PanelAsset> assets = new Dictionary<string, PanelAsset>(StringComparer.Ordinal);
            foreach (PanelAsset asset in document.assets)
            {
                if (asset == null || !IsSha(asset.sha256) || asset.path != "textures/" + asset.sha256 + ".png" || asset.bytes < 45 || asset.bytes > MAX_IMAGE_BYTES || asset.width < 1 || asset.width > 4096 || asset.height < 1 || asset.height > 4096 || assets.ContainsKey(asset.path)) throw new InvalidDataException("PANEL_IMPORT_ASSET_RECORD");
                assets.Add(asset.path, asset);
            }
            Dictionary<string, PanelNode> nodes = new Dictionary<string, PanelNode>(StringComparer.Ordinal);
            Dictionary<string, int> depths = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (PanelNode node in document.nodes)
            {
                if (node == null || !ValidId(node.id) || nodes.ContainsKey(node.id) || !new[] { "Container", "Text", "Image", "Slider", "Switch", "Select", "Button", "ProgressBar", "ScrollView", "Tabs", "Input" }.Contains(node.type)) throw new InvalidDataException("PANEL_IMPORT_NODE_ID_TYPE");
                if (!Finite(node.x) || !Finite(node.y) || node.x < 0 || node.y < 0 || !Positive(node.width, 65536) || !Positive(node.height, 65536) || !Finite(node.opacity) || node.opacity < 0 || node.opacity > 1 || !Finite(node.borderWidth) || node.borderWidth < 0 || node.borderWidth > 256 || !Finite(node.cornerRadius) || node.cornerRadius < 0 || node.cornerRadius > 4096 || !ValidColor(node.backgroundColor) || !ValidColor(node.borderColor) || !ValidColor(node.textColor) || node.fontSize < 1 || node.fontSize > 256 || !ValidText(node.text, 512)) throw new InvalidDataException("PANEL_IMPORT_NODE_STYLE_GEOMETRY");
                if (nodes.Count == 0)
                {
                    if (node.parentId != "" || node.type != "Container" || node.x != 0 || node.y != 0 || node.width != document.canvasWidth || node.height != document.canvasHeight) throw new InvalidDataException("PANEL_IMPORT_CANVAS_ROOT");
                    depths.Add(node.id, 0);
                }
                else
                {
                    PanelNode parent;
                    if (node.parentId == null || !nodes.TryGetValue(node.parentId, out parent) || (parent.type != "Container" && parent.type != "ScrollView" && parent.type != "Tabs")) throw new InvalidDataException("PANEL_IMPORT_PARENT_ORDER");
                    int depth = depths[parent.id] + 1;
                    if (depth > 32) throw new InvalidDataException("PANEL_IMPORT_NODE_DEPTH");
                    depths.Add(node.id, depth);
                    float parentWidth = parent.type == "ScrollView" ? parent.contentWidth : parent.width;
                    float parentHeight = parent.type == "ScrollView" ? parent.contentHeight : parent.height;
                    if (node.x + node.width > parentWidth + 0.01f || node.y + node.height > parentHeight + 0.01f) throw new InvalidDataException("PANEL_IMPORT_CHILD_OVERFLOW");
                }
                if (node.type == "ScrollView" && (!Positive(node.contentWidth, 65536) || !Positive(node.contentHeight, 65536) || node.contentWidth < node.width || node.contentHeight < node.height)) throw new InvalidDataException("PANEL_IMPORT_SCROLL_GEOMETRY");
                if (node.type == "Text" && node.drawBackground) throw new InvalidDataException("PANEL_IMPORT_TEXT_BACKGROUND_UNSUPPORTED");
                if (node.type == "Image")
                {
                    PanelAsset asset;
                    if (node.source == null || !assets.TryGetValue(node.source, out asset) || (node.fit != "contain" && node.fit != "stretch")) throw new InvalidDataException("PANEL_IMPORT_IMAGE_SOURCE");
                    if (node.hasRegion && (!Finite(node.regionX) || !Finite(node.regionY) || node.regionX < 0 || node.regionY < 0 || !Positive(node.regionWidth, asset.width) || !Positive(node.regionHeight, asset.height) || node.regionX + node.regionWidth > asset.width || node.regionY + node.regionHeight > asset.height)) throw new InvalidDataException("PANEL_IMPORT_IMAGE_REGION");
                }
                nodes.Add(node.id, node);
            }
            Dictionary<string, PanelField> fields = new Dictionary<string, PanelField>(StringComparer.Ordinal);
            foreach (PanelField field in document.fields)
            {
                if (field == null || !ValidId(field.id) || fields.ContainsKey(field.id) || field.options == null || field.options.Length > 8) throw new InvalidDataException("PANEL_IMPORT_FIELD_ID");
                if (field.type == "number")
                {
                    double steps = (field.max - field.min) / field.step;
                    if (!Finite(field.min) || !Finite(field.max) || !Finite(field.step) || field.step <= 0 || field.max <= field.min || !Finite(steps) || steps > 1000000 || !IsInteger(steps) || !ValidNumber(field, field.initialNumber) || !ValidNumber(field, field.numberValue)) throw new InvalidDataException("PANEL_IMPORT_NUMBER_FIELD");
                }
                else if (field.type == "progress")
                {
                    if ((document.panelSpecVersion != "0.5" && document.panelSpecVersion != "0.6" && document.panelSpecVersion != "0.7") || field.min != 0 || field.step != 0 || !Finite(field.max) || field.max <= 0
                        || !ValidProgress(field, field.initialNumber) || !ValidProgress(field, field.numberValue)) throw new InvalidDataException("PANEL_IMPORT_PROGRESS_FIELD");
                }
                else if (field.type == "enum")
                {
                    HashSet<string> options = new HashSet<string>(StringComparer.Ordinal);
                    foreach (PanelOption option in field.options) if (option == null || !ValidId(option.id) || !options.Add(option.id) || !ValidText(option.label, 120) || string.IsNullOrWhiteSpace(option.label)) throw new InvalidDataException("PANEL_IMPORT_ENUM_OPTION");
                    if (options.Count < 1 || !options.Contains(field.initialString) || !options.Contains(field.stringValue)) throw new InvalidDataException("PANEL_IMPORT_ENUM_VALUE");
                }
                else if (field.type == "string")
                {
                    if (document.panelSpecVersion != "0.7" || !PanelController.StringValid(field.initialString, field.maxLength)
                        || !PanelController.StringValid(field.stringValue, field.maxLength)) throw new InvalidDataException("PANEL_IMPORT_STRING_FIELD");
                }
                else if (field.type != "boolean") throw new InvalidDataException("PANEL_IMPORT_FIELD_TYPE");
                fields.Add(field.id, field);
            }
            HashSet<string> controlNodes = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> rowIds = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> usedFields = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> events = new HashSet<string>(StringComparer.Ordinal);
            foreach (PanelControl control in document.controls)
            {
                PanelNode node;
                if (control == null || !ValidId(control.rowId) || !rowIds.Add(control.rowId) || control.nodeId == null || !nodes.TryGetValue(control.nodeId, out node) || !controlNodes.Add(control.nodeId) || control.resetFields == null || control.resetFields.Length > 128 || !ValidText(control.prefix, 32) || !ValidText(control.suffix, 32) || control.fractionDigits < 0 || control.fractionDigits > 6) throw new InvalidDataException("PANEL_IMPORT_CONTROL_RECORD");
                if (control.kind == "progress")
                {
                    if (control.eventName != "" || control.enabled || control.prefix != "" || control.suffix != ""
                        || (control.displayMode != "percent" && control.displayMode != "value")) throw new InvalidDataException("PANEL_IMPORT_PROGRESS_CONTROL");
                }
                else if (!ValidId(control.eventName) || !events.Add(control.eventName)) throw new InvalidDataException("PANEL_IMPORT_CONTROL_EVENT");
                string type = control.kind == "slider" ? "Slider" : control.kind == "switch" ? "Switch" : control.kind == "select" ? "Select" : control.kind == "button" ? "Button" : control.kind == "progress" ? "ProgressBar" : control.kind == "tabs" ? "Tabs" : control.kind == "input" ? "Input" : "";
                if (type == "" || node.type != type) throw new InvalidDataException("PANEL_IMPORT_CONTROL_TYPE");
                if (control.kind == "button")
                {
                    if (control.fieldId != "" || (control.action != "emit" && control.action != "reset-initial" && control.action != "submit") || (control.action == "emit" && control.resetFields.Length != 0) || (control.action == "reset-initial" && control.resetFields.Length == 0)) throw new InvalidDataException("PANEL_IMPORT_BUTTON_ACTION");
                    if (control.action == "submit")
                    {
                        if (document.panelSpecVersion != "0.7" || control.resetFields.Length != 0 || control.submitFields == null || control.submitFields.Length < 1 || control.submitFields.Length > 128) throw new InvalidDataException("PANEL_IMPORT_SUBMIT_SCOPE");
                        HashSet<string> submitted = new HashSet<string>(StringComparer.Ordinal);
                        foreach (string id in control.submitFields)
                            if (id == null || !fields.ContainsKey(id) || fields[id].type != "string" || !submitted.Add(id)
                                || !document.controls.Any(item => item != null && item.kind == "input" && item.fieldId == id)) throw new InvalidDataException("PANEL_IMPORT_SUBMIT_FIELD");
                    }
                    else if (control.submitFields != null && control.submitFields.Length != 0) throw new InvalidDataException("PANEL_IMPORT_SUBMIT_UNEXPECTED");
                    HashSet<string> resetFields = new HashSet<string>(StringComparer.Ordinal);
                    foreach (string field in control.resetFields) if (field == null || !fields.ContainsKey(field) || !resetFields.Add(field)) throw new InvalidDataException("PANEL_IMPORT_RESET_FIELD");
                }
                else
                {
                    PanelField field;
                    string expected = control.kind == "slider" ? "number" : control.kind == "switch" ? "boolean" : control.kind == "progress" ? "progress" : control.kind == "input" ? "string" : "enum";
                    if (control.fieldId == null || !fields.TryGetValue(control.fieldId, out field) || field.type != expected || control.action != "" || control.resetFields.Length != 0) throw new InvalidDataException("PANEL_IMPORT_BINDING");
                    if (!usedFields.Add(field.id)) throw new InvalidDataException("PANEL_IMPORT_DUPLICATE_BINDING");
                    if (control.kind == "progress" && control.displayMode == "value" && field.max >= 1E21) throw new InvalidDataException("PANEL_IMPORT_PROGRESS_FORMAT_LIMIT");
                    if (control.kind == "input")
                    {
                        if (!PanelController.InputMetadataValid(control, field)) throw new InvalidDataException("PANEL_IMPORT_INPUT_METADATA");
                        string[] errorIds = { control.requiredErrorTextId, control.minLengthErrorTextId };
                        string[] messages = { control.validation.requiredMessage, control.validation.minLengthMessage };
                        for (int i = 0; i < errorIds.Length; i++)
                        {
                            PanelNode errorNode;
                            if (errorIds[i] == null || !nodes.TryGetValue(errorIds[i], out errorNode) || errorNode.type != "Text"
                                || errorNode.parentId != node.parentId || errorNode.text != messages[i]) throw new InvalidDataException("PANEL_IMPORT_INPUT_ERROR_TEXT");
                        }
                        if (errorIds[0] == errorIds[1]) throw new InvalidDataException("PANEL_IMPORT_INPUT_ERROR_ID");
                    }
                    if (control.kind == "tabs")
                    {
                        if ((document.panelSpecVersion != "0.6" && document.panelSpecVersion != "0.7") || field.options.Length < 2 || node.height < 104 || node.width / field.options.Length < 24
                            || control.contentIds == null || control.contentIds.Length != field.options.Length
                            || control.contentIds.Distinct(StringComparer.Ordinal).Count() != control.contentIds.Length) throw new InvalidDataException("PANEL_IMPORT_TABS_RECORD");
                        foreach (string id in control.contentIds)
                        {
                            PanelNode page;
                            if (id == null || !nodes.TryGetValue(id, out page) || page.parentId != node.id || (page.type != "Container" && page.type != "ScrollView") || page.y < 48) throw new InvalidDataException("PANEL_IMPORT_TABS_PAGE");
                        }
                        if (document.nodes.Count(item => item.parentId == node.id) != control.contentIds.Length) throw new InvalidDataException("PANEL_IMPORT_TABS_PAGE_COVERAGE");
                    }
                }
                if (control.kind == "slider" || control.kind == "progress")
                {
                    PanelNode valueNode;
                    if (control.valueTextId == null || !nodes.TryGetValue(control.valueTextId, out valueNode) || valueNode.type != "Text") throw new InvalidDataException("PANEL_IMPORT_SLIDER_VALUE_TEXT");
                }
                else if (control.valueTextId != "") throw new InvalidDataException("PANEL_IMPORT_VALUE_TEXT_UNEXPECTED");
            }
            foreach (PanelNode node in document.nodes) if (new[] { "Slider", "Switch", "Select", "Button", "ProgressBar", "Tabs", "Input" }.Contains(node.type) && !controlNodes.Contains(node.id)) throw new InvalidDataException("PANEL_IMPORT_UNBOUND_CONTROL");
            if (usedFields.Count != fields.Count) throw new InvalidDataException("PANEL_IMPORT_UNUSED_FIELD");
        }

        private static Dictionary<string, Texture2D> ImportTextures(ImportData data, string folder)
        {
            Dictionary<string, Texture2D> textures = new Dictionary<string, Texture2D>(StringComparer.Ordinal);
            if (data.document.assets.Length == 0) return textures;
            if (!AssetDatabase.IsValidFolder(folder + "/Textures")) AssetDatabase.CreateFolder(folder, "Textures");
            if (!AssetDatabase.IsValidFolder(folder + "/Sprites")) AssetDatabase.CreateFolder(folder, "Sprites");
            foreach (PanelAsset asset in data.document.assets)
            {
                string path = folder + "/Textures/" + asset.sha256 + ".png";
                string absolute = ToAbsoluteAssetPath(path);
                AssertNoLinks(absolute);
                if (File.Exists(absolute))
                {
                    if (Hash(File.ReadAllBytes(absolute)) != asset.sha256) throw new InvalidDataException("PANEL_IMPORT_EXISTING_TEXTURE_CHANGED");
                    Texture2D existing = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
                    if (existing == null || existing.width != asset.width || existing.height != asset.height) throw new InvalidDataException("PANEL_IMPORT_EXISTING_TEXTURE_INVALID");
                    textures.Add(asset.path, existing);
                    continue;
                }
                File.WriteAllBytes(absolute, data.images[asset.path]);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
                TextureImporter importer = AssetImporter.GetAtPath(path) as TextureImporter;
                if (importer == null) throw new InvalidDataException("PANEL_IMPORT_TEXTURE_DECODE");
                importer.textureType = TextureImporterType.Sprite;
                importer.spriteImportMode = SpriteImportMode.Single;
                importer.mipmapEnabled = false;
                importer.alphaIsTransparency = true;
                importer.npotScale = TextureImporterNPOTScale.None;
                importer.textureCompression = TextureImporterCompression.Uncompressed;
                importer.maxTextureSize = 4096;
                importer.filterMode = FilterMode.Bilinear;
                importer.wrapMode = TextureWrapMode.Clamp;
                importer.SaveAndReimport();
                Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
                if (texture == null || texture.width != asset.width || texture.height != asset.height) throw new InvalidDataException("PANEL_IMPORT_TEXTURE_DIMENSIONS");
                textures.Add(asset.path, texture);
            }
            return textures;
        }

        private static void AddImage(GameObject target, PanelNode node, Dictionary<string, Texture2D> textures, Dictionary<string, Sprite> sprites, string folder)
        {
            GameObject imageObject = target;
            if (node.drawBackground)
            {
                AddBackground(target, node);
                imageObject = Child(target, "__image", 0, 0, node.width, node.height);
            }
            Texture2D texture = textures[node.source];
            float x = node.hasRegion ? node.regionX : 0;
            float y = node.hasRegion ? texture.height - node.regionY - node.regionHeight : 0;
            float width = node.hasRegion ? node.regionWidth : texture.width;
            float height = node.hasRegion ? node.regionHeight : texture.height;
            string key = node.source + ":" + x.ToString("R", CultureInfo.InvariantCulture) + ":" + y.ToString("R", CultureInfo.InvariantCulture) + ":" + width.ToString("R", CultureInfo.InvariantCulture) + ":" + height.ToString("R", CultureInfo.InvariantCulture);
            Sprite sprite;
            if (!sprites.TryGetValue(key, out sprite))
            {
                string name = "sprite-" + Hash(Encoding.UTF8.GetBytes(key));
                string spritePath = folder + "/Sprites/" + name + ".asset";
                AssertNoLinks(ToAbsoluteAssetPath(spritePath));
                sprite = AssetDatabase.LoadAssetAtPath<Sprite>(spritePath);
                if (sprite == null)
                {
                    if (File.Exists(ToAbsoluteAssetPath(spritePath))) throw new InvalidDataException("PANEL_IMPORT_EXISTING_SPRITE_INVALID");
                    sprite = Sprite.Create(texture, new Rect(x, y, width, height), new Vector2(0.5f, 0.5f), 1, 0, SpriteMeshType.FullRect);
                    sprite.name = name;
                    AssetDatabase.CreateAsset(sprite, spritePath);
                }
                else if (sprite.texture != texture || sprite.rect != new Rect(x, y, width, height) || sprite.pivot != new Vector2(width / 2, height / 2) || sprite.pixelsPerUnit != 1) throw new InvalidDataException("PANEL_IMPORT_EXISTING_SPRITE_CHANGED");
                sprites.Add(key, sprite);
            }
            Image image = imageObject.AddComponent<Image>();
            image.sprite = sprite;
            image.type = Image.Type.Simple;
            image.preserveAspect = node.fit == "contain";
            image.color = new Color(1, 1, 1, node.opacity);
            image.raycastTarget = false;
        }

        private static Sprite ProgressSprite(string folder)
        {
            AssertNoLinks(ToAbsoluteAssetPath(folder + "/Textures"));
            if (!AssetDatabase.IsValidFolder(folder + "/Textures")) AssetDatabase.CreateFolder(folder, "Textures");
            // An owned opaque white pixel removes the default UGUI sprite's bevel/gradient.
            byte[] bytes = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==");
            string path = folder + "/Textures/" + Hash(bytes) + ".png";
            string absolute = ToAbsoluteAssetPath(path);
            AssertNoLinks(absolute);
            if (File.Exists(absolute))
            {
                if (!File.ReadAllBytes(absolute).SequenceEqual(bytes)) throw new InvalidOperationException("PANEL_PROGRESS_TEXTURE_CHANGED");
            }
            else File.WriteAllBytes(absolute, bytes);
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            TextureImporter importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer == null) throw new InvalidOperationException("PANEL_PROGRESS_TEXTURE_IMPORTER_MISSING");
            importer.textureType = TextureImporterType.Sprite; importer.spriteImportMode = SpriteImportMode.Single;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.npotScale = TextureImporterNPOTScale.None; importer.filterMode = FilterMode.Point;
            importer.wrapMode = TextureWrapMode.Clamp; importer.spritePixelsPerUnit = 1;
            importer.SaveAndReimport();
            Sprite sprite = AssetDatabase.LoadAssetAtPath<Sprite>(path);
            if (sprite == null) throw new InvalidOperationException("PANEL_PROGRESS_SPRITE_MISSING");
            return sprite;
        }

        private static void BuildProgress(GameObject target, PanelNode node, PanelControlView view, string folder)
        {
            // Native UGUI Image fill; no Slider, selectable, pointer handler or timer.
            Sprite sprite = ProgressSprite(folder);
            Image track = target.AddComponent<Image>();
            track.sprite = sprite; track.type = Image.Type.Simple;
            track.color = ParseColor(node.backgroundColor, node.opacity); track.raycastTarget = false;
            GameObject fillObject = Child(target, "__progress-fill", 1, 1, Math.Max(1, node.width - 2), Math.Max(1, node.height - 2));
            Image fill = fillObject.AddComponent<Image>();
            fill.sprite = sprite; fill.type = Image.Type.Filled; fill.fillMethod = Image.FillMethod.Horizontal;
            fill.fillOrigin = (int)Image.OriginHorizontal.Left; fill.fillAmount = 0;
            fill.color = ParseColor(node.borderColor, node.opacity); fill.raycastTarget = false;
            view.progressFill = fill;
        }

        private static void BuildSlider(GameObject target, PanelNode node, PanelControlView view)
        {
            Slider slider = target.AddComponent<Slider>();
            GameObject track = Child(target, "__track", 0, (node.height - 8) / 2, node.width, 8);
            AddGraphic(track, ParseColor(node.backgroundColor, node.opacity), Color.clear, 0, 4);
            GameObject fillArea = Child(target, "__fill-area", 0, (node.height - 8) / 2, node.width, 8);
            GameObject fill = Child(fillArea, "__fill", 0, 0, node.width, 8);
            Stretch((RectTransform)fill.transform);
            AddGraphic(fill, ParseColor(node.borderColor, node.opacity), Color.clear, 0, 4);
            GameObject handleArea = Child(target, "__handle-area", 10, (node.height - 20) / 2, Math.Max(1, node.width - 20), 20);
            GameObject handle = Child(handleArea, "__handle", 0, 0, 20, 20);
            PanelRoundedGraphic handleGraphic = AddGraphic(handle, ParseColor(node.borderColor, node.opacity), Color.clear, 0, 10);
            RectTransform handleRect = (RectTransform)handle.transform;
            handleRect.pivot = new Vector2(0.5f, 0.5f);
            handleRect.anchorMin = Vector2.zero;
            handleRect.anchorMax = new Vector2(0, 1);
            handleRect.anchoredPosition = Vector2.zero;
            // Slider drives the perpendicular anchors to 0..1; keep that axis's offset zero.
            handleRect.sizeDelta = new Vector2(20, 0);
            slider.fillRect = (RectTransform)fill.transform;
            slider.handleRect = handleRect;
            slider.direction = Slider.Direction.LeftToRight;
            slider.targetGraphic = handleGraphic;
            slider.wholeNumbers = true;
            ConfigureSelectable(slider, view.definition.enabled);
            view.slider = slider;
        }

        private static void BuildToggle(GameObject target, PanelNode node, PanelControlView view)
        {
            Toggle toggle = target.AddComponent<Toggle>();
            GameObject track = Child(target, "__track", 0, (node.height - 30) / 2, node.width, 30);
            PanelRoundedGraphic background = AddGraphic(track, ParseColor(node.backgroundColor, node.opacity), ParseColor(node.borderColor, node.opacity), 1, 15);
            GameObject mark = Child(track, "__checked", node.width - 26, 4, 22, 22);
            PanelRoundedGraphic markGraphic = AddGraphic(mark, ParseColor(node.borderColor, node.opacity), Color.clear, 0, 11);
            toggle.targetGraphic = background;
            toggle.graphic = markGraphic;
            toggle.toggleTransition = Toggle.ToggleTransition.None;
            ConfigureSelectable(toggle, view.definition.enabled);
            view.toggle = toggle;
        }

        private static void BuildInput(GameObject target, PanelNode node, PanelControlView view, PanelField field, Font font)
        {
            PanelRoundedGraphic background = AddBackground(target, node);
            InputField input = target.AddComponent<InputField>();
            input.targetGraphic = background;
            ConfigureSelectable(input, view.definition.enabled);
            GameObject viewport = Child(target, "__input-viewport", 10, 0, Math.Max(1, node.width - 20), node.height);
            viewport.AddComponent<RectMask2D>();
            GameObject label = Child(viewport, "__input-text", 0, 0, Math.Max(1, node.width - 20), node.height);
            Text text = AddText(label, "", node, font, TextAnchor.MiddleLeft);
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            GameObject placeholder = Child(viewport, "__placeholder", 0, 0, Math.Max(1, node.width - 20), node.height);
            Text placeholderText = AddText(placeholder, view.definition.placeholder, node, font, TextAnchor.MiddleLeft);
            placeholderText.color = new Color(text.color.r, text.color.g, text.color.b, text.color.a * 0.6f);
            input.textComponent = text; input.placeholder = placeholderText;
            input.contentType = view.definition.inputType == "password" ? InputField.ContentType.Password : InputField.ContentType.Standard;
            input.lineType = InputField.LineType.SingleLine; input.characterLimit = field.maxLength;
            input.readOnly = view.definition.readOnly; input.SetTextWithoutNotify(field.stringValue);
            view.input = input;
        }

        private static void BuildButton(GameObject target, PanelNode node, PanelControlView view, Font font)
        {
            PanelRoundedGraphic background = AddBackground(target, node);
            Button button = target.AddComponent<Button>();
            button.targetGraphic = background;
            ConfigureSelectable(button, view.definition.enabled);
            GameObject label = Child(target, "__label", 8, 0, Math.Max(1, node.width - 16), node.height);
            AddText(label, node.text, node, font, TextAnchor.MiddleCenter);
            view.button = button;
        }

        private static void BuildTabs(GameObject target, PanelNode node, PanelControlView view, PanelField field, Font font)
        {
            view.tabButtons = new Button[field.options.Length];
            view.tabActiveColor = ParseColor(node.borderColor, node.opacity);
            view.tabIdleColor = ParseColor(node.backgroundColor, node.opacity);
            float width = node.width / field.options.Length;
            for (int i = 0; i < field.options.Length; i++)
            {
                GameObject tab = Child(target, "__tab_" + field.options[i].id, i * width, 0, width, 48);
                PanelRoundedGraphic graphic = AddGraphic(tab, Color.white, Color.clear, 0, 6);
                Button button = tab.AddComponent<Button>(); button.targetGraphic = graphic;
                ConfigureSelectable(button, view.definition.enabled);
                button.transition = Selectable.Transition.None;
                GameObject label = Child(tab, "__label", 8, 0, Math.Max(1, width - 16), 48);
                AddText(label, field.options[i].label, node, font, TextAnchor.MiddleCenter);
                view.tabButtons[i] = button;
            }
            for (int i = 0; i < view.tabButtons.Length; i++)
            {
                Navigation navigation = new Navigation { mode = Navigation.Mode.Explicit,
                    selectOnLeft = view.tabButtons[(i + view.tabButtons.Length - 1) % view.tabButtons.Length],
                    selectOnRight = view.tabButtons[(i + 1) % view.tabButtons.Length] };
                view.tabButtons[i].navigation = navigation;
            }
        }

        private static void BuildDropdown(GameObject target, PanelNode node, PanelControlView view, PanelField field, Font font)
        {
            PanelRoundedGraphic background = AddBackground(target, node);
            Dropdown dropdown = target.AddComponent<Dropdown>();
            dropdown.targetGraphic = background;
            ConfigureSelectable(dropdown, view.definition.enabled);
            GameObject label = Child(target, "__caption", 10, 0, Math.Max(1, node.width - 38), node.height);
            dropdown.captionText = AddText(label, "", node, font, TextAnchor.MiddleLeft);
            GameObject arrow = Child(target, "__arrow", node.width - 26, 0, 20, node.height);
            AddText(arrow, "v", node, font, TextAnchor.MiddleCenter);
            float itemHeight = Math.Max(32, node.height);
            float menuHeight = Math.Min(field.options.Length * itemHeight, 240);
            GameObject template = Child(target, "__template", 0, node.height + 2, node.width, menuHeight);
            AddBackground(template, node);
            RectTransform templateRect = (RectTransform)template.transform;
            templateRect.anchorMin = Vector2.zero;
            templateRect.anchorMax = new Vector2(1, 0);
            templateRect.pivot = new Vector2(0.5f, 1);
            templateRect.anchoredPosition = new Vector2(0, -2);
            templateRect.sizeDelta = new Vector2(0, menuHeight);
            GameObject viewport = Child(template, "__viewport", 0, 0, node.width, menuHeight);
            Stretch((RectTransform)viewport.transform);
            viewport.AddComponent<RectMask2D>();
            GameObject content = Child(viewport, "__content", 0, 0, node.width, itemHeight);
            RectTransform contentRect = (RectTransform)content.transform;
            contentRect.anchorMin = new Vector2(0, 1);
            contentRect.anchorMax = Vector2.one;
            contentRect.pivot = new Vector2(0.5f, 1);
            contentRect.anchoredPosition = Vector2.zero;
            contentRect.sizeDelta = new Vector2(0, itemHeight);
            GameObject item = Child(content, "__item", 0, 0, node.width, itemHeight);
            RectTransform itemRect = (RectTransform)item.transform;
            itemRect.anchorMin = new Vector2(0, 0.5f);
            itemRect.anchorMax = new Vector2(1, 0.5f);
            itemRect.pivot = new Vector2(0.5f, 0.5f);
            itemRect.anchoredPosition = Vector2.zero;
            itemRect.sizeDelta = new Vector2(0, itemHeight);
            PanelRoundedGraphic itemBackground = AddBackground(item, node);
            Toggle itemToggle = item.AddComponent<Toggle>();
            itemToggle.targetGraphic = itemBackground;
            ConfigureSelectable(itemToggle, true);
            GameObject check = Child(item, "__check", 5, (itemHeight - 8) / 2, 8, 8);
            itemToggle.graphic = AddGraphic(check, ParseColor(node.textColor, node.opacity), Color.clear, 0, 4);
            GameObject itemLabel = Child(item, "__label", 20, 0, Math.Max(1, node.width - 30), itemHeight);
            dropdown.itemText = AddText(itemLabel, "", node, font, TextAnchor.MiddleLeft);
            ScrollRect scroll = template.AddComponent<ScrollRect>();
            scroll.content = contentRect;
            scroll.viewport = (RectTransform)viewport.transform;
            scroll.horizontal = false;
            scroll.vertical = true;
            scroll.movementType = ScrollRect.MovementType.Clamped;
            scroll.scrollSensitivity = 24;
            scroll.inertia = false;
            dropdown.template = templateRect;
            dropdown.options = field.options.Select(option => new Dropdown.OptionData(option.label)).ToList();
            template.SetActive(false);
            view.dropdown = dropdown;
        }

        private static Transform BuildScroll(GameObject target, PanelNode node)
        {
            if (node.drawBackground) AddBackground(target, node);
            else
            {
                // Keep a raycastable quad for wheel/drag gestures over empty content space.
                Image hitArea = target.AddComponent<Image>();
                hitArea.color = Color.clear;
                hitArea.raycastTarget = true;
            }
            ScrollRect scroll = target.AddComponent<ScrollRect>();
            GameObject viewport = Child(target, "__viewport", 0, 0, node.width, node.height);
            Stretch((RectTransform)viewport.transform);
            viewport.AddComponent<RectMask2D>();
            GameObject content = Child(viewport, "__content", 0, 0, node.contentWidth, node.contentHeight);
            scroll.viewport = (RectTransform)viewport.transform;
            scroll.content = (RectTransform)content.transform;
            scroll.horizontal = false;
            scroll.vertical = true;
            scroll.movementType = ScrollRect.MovementType.Clamped;
            scroll.inertia = false;
            scroll.scrollSensitivity = 24;
            scroll.verticalNormalizedPosition = 1;
            return content.transform;
        }

        private static PanelRoundedGraphic AddBackground(GameObject target, PanelNode node)
        {
            return AddGraphic(target, ParseColor(node.backgroundColor, node.opacity), ParseColor(node.borderColor, node.opacity), node.borderWidth, node.cornerRadius);
        }

        private static PanelRoundedGraphic AddGraphic(GameObject target, Color fill, Color border, float borderWidth, float radius)
        {
            PanelRoundedGraphic graphic = target.AddComponent<PanelRoundedGraphic>();
            graphic.SetStyle(fill, border, borderWidth, radius);
            return graphic;
        }

        private static Text AddText(GameObject target, string value, PanelNode node, Font font, TextAnchor alignment)
        {
            Text text = target.AddComponent<Text>();
            text.font = font;
            text.fontSize = node.fontSize;
            text.fontStyle = node.bold ? FontStyle.Bold : FontStyle.Normal;
            text.color = ParseColor(node.textColor, node.opacity);
            text.text = value;
            text.alignment = alignment;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            // A host font may have taller CJK metrics than the source's 1.3x text slot.
            // Keep the stable slot and center a single line inside its containing row.
            text.verticalOverflow = VerticalWrapMode.Overflow;
            text.supportRichText = false;
            text.raycastTarget = false;
            return text;
        }

        private static GameObject Child(GameObject parent, string name, float x, float y, float width, float height)
        {
            GameObject child = new GameObject(parent.name + "." + name, typeof(RectTransform));
            child.transform.SetParent(parent.transform, false);
            SetRect((RectTransform)child.transform, x, y, width, height);
            return child;
        }

        private static void SetRect(RectTransform rect, float x, float y, float width, float height)
        {
            rect.anchorMin = new Vector2(0, 1);
            rect.anchorMax = new Vector2(0, 1);
            rect.pivot = new Vector2(0, 1);
            rect.anchoredPosition = new Vector2(x, -y);
            rect.sizeDelta = new Vector2(width, height);
        }

        private static void Stretch(RectTransform rect)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
        }

        private static void ConfigureSelectable(Selectable selectable, bool enabled)
        {
            selectable.interactable = enabled;
            ColorBlock colors = ColorBlock.defaultColorBlock;
            colors.normalColor = Color.white;
            colors.highlightedColor = new Color(0.92f, 0.98f, 0.96f, 1);
            colors.pressedColor = new Color(0.72f, 0.84f, 0.80f, 1);
            colors.selectedColor = new Color(0.88f, 0.98f, 0.94f, 1);
            colors.disabledColor = new Color(0.65f, 0.65f, 0.65f, 0.5f);
            colors.fadeDuration = 0.08f;
            selectable.colors = colors;
            selectable.transition = Selectable.Transition.ColorTint;
        }

        private static string ValidateNewAssetFolder(string path)
        {
            if (string.IsNullOrEmpty(path) || path.Length > 240 || !path.StartsWith("Assets/", StringComparison.Ordinal) || path.IndexOf('\\') >= 0) throw new ArgumentException("PANEL_IMPORT_OUTPUT_ASSET_FOLDER");
            string[] parts = path.Split('/');
            foreach (string part in parts)
            {
                if (!Regex.IsMatch(part, "^[A-Za-z0-9][A-Za-z0-9._-]*\\z") || part.EndsWith(".", StringComparison.Ordinal) || Regex.IsMatch(part, "^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\\.|$)", RegexOptions.IgnoreCase)) throw new ArgumentException("PANEL_IMPORT_OUTPUT_SEGMENT");
            }
            string full = ToAbsoluteAssetPath(path);
            AssertNoLinks(full);
            string parent = path.Substring(0, path.LastIndexOf('/'));
            if (!AssetDatabase.IsValidFolder(parent) || !Directory.Exists(Path.GetDirectoryName(full)) || Directory.Exists(full) || File.Exists(full) || File.Exists(full + ".meta")) throw new IOException("PANEL_IMPORT_NEW_FOLDER_WITH_EXISTING_PARENT_REQUIRED");
            return full;
        }

        private static string ToAbsoluteAssetPath(string assetPath)
        {
            string project = Path.GetDirectoryName(Application.dataPath);
            string full = Path.GetFullPath(Path.Combine(project, assetPath.Replace('/', Path.DirectorySeparatorChar)));
            string assets = Path.GetFullPath(Application.dataPath).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            StringComparison comparison = Application.platform == RuntimePlatform.WindowsEditor ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
            if (!full.StartsWith(assets, comparison)) throw new ArgumentException("PANEL_IMPORT_ASSETS_BOUNDARY");
            return full;
        }

        private static void AssertNoLinks(string path)
        {
            string current = Path.GetFullPath(path);
            while (!string.IsNullOrEmpty(current))
            {
                try
                {
                    if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("PANEL_IMPORT_SYMLINK_REJECTED");
                }
                catch (FileNotFoundException) { }
                catch (DirectoryNotFoundException) { }
                string parent = Path.GetDirectoryName(current);
                if (parent == current) break;
                current = parent;
            }
        }

        private static bool ValidId(string value) { return value != null && ID.IsMatch(value); }
        private static bool IsSha(string value) { return value != null && SHA.IsMatch(value); }
        private static bool ValidColor(string value) { return value != null && COLOR.IsMatch(value); }
        private static bool Finite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }
        private static bool Positive(float value, float maximum) { return Finite(value) && value > 0 && value <= maximum; }
        private static bool IsInteger(double value) { return Math.Abs(value - Math.Round(value)) <= Math.Min(1e-7, 16 * 2.2204460492503131e-16 * Math.Max(1, Math.Abs(value))); }
        private static bool ValidNumber(PanelField field, double value) { return Finite(value) && value >= field.min && value <= field.max && IsInteger((value - field.min) / field.step); }
        private static bool ValidProgress(PanelField field, double value) { return Finite(value) && value >= 0 && value <= field.max; }
        private static bool ValidText(string value, int maximum) { return value != null && value.Length <= maximum && !value.Any(character => char.IsControl(character)); }
        private static Color ParseColor(string value, float opacity) { Color color; ColorUtility.TryParseHtmlString(value, out color); color.a = opacity; return color; }
        private static uint ReadBigEndian(byte[] bytes, int offset) { return ((uint)bytes[offset] << 24) | ((uint)bytes[offset + 1] << 16) | ((uint)bytes[offset + 2] << 8) | bytes[offset + 3]; }
        private static string Hash(byte[] bytes) { using (SHA256 sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
    }
}
#endif
