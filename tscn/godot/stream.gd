extends Node3D
## Hedwig TSCN 推流服务器端脚本
## 挂在 Main 节点上。
## 功能：
##   1. 以 WebSocket 客户端身份连接本机中转服务（tscn/server/relay.py）
##   2. 接收来自浏览器操纵杆的移动输入，驱动 Player（CharacterBody3D）
##   3. 定时把 viewport 画面编码为 JPEG 通过 WebSocket 发回中转，广播给浏览器
##
## 之后想换成自己的场景：只要保留名为 "Player" 的 CharacterBody3D 节点
## 和本脚本，替换/扩展其他场景内容即可；也可以把整份脚本挂到新场景根节点。

# ========== 可配置项 ==========
const RELAY_URL := "ws://127.0.0.1:8765/godot"   # 中转服务地址（Godot 作为客户端连入）
const FRAME_FPS := 15.0                           # 推流帧率
const JPEG_QUALITY := 60                          # JPEG 质量（1-100，越小越省带宽）
const MOVE_SPEED := 5.0                           # 玩家移动速度（米/秒）

# ========== 内部状态 ==========
var _ws := WebSocketPeer.new()
var _player: CharacterBody3D
var _camera: Camera3D
var _input := Vector2.ZERO       # 当前移动输入（x 左右，y 前后），范围 [-1,1]
var _frame_accum := 0.0
var _reconnect_timer := 0.0


func _ready() -> void:
	_player = $Player
	_camera = $Camera3D
	_connect_to_relay()


func _connect_to_relay() -> void:
	var err := _ws.connect_to_url(RELAY_URL)
	if err != OK:
		push_error("连接中转服务失败: %s (err=%s)" % [RELAY_URL, err])
	else:
		print("[HedwigTscn] 正在连接中转服务: ", RELAY_URL)


func _physics_process(delta: float) -> void:
	_poll_socket()

	# ---- 移动：输入是操纵杆向量，y 为前后、x 为左右 ----
	var dir := Vector3.ZERO
	if _input.length() > 0.05:
		# 以相机朝向为参考系移动
		var cam_basis := _camera.global_transform.basis
		var forward := -cam_basis.z
		forward.y = 0
		forward = forward.normalized()
		var right := cam_basis.x
		right.y = 0
		right = right.normalized()
		dir = (forward * -_input.y + right * _input.x).normalized()

	_player.velocity.x = dir.x * MOVE_SPEED
	_player.velocity.z = dir.z * MOVE_SPEED
	_player.velocity.y -= 18.0 * delta   # 简单重力
	_player.move_and_slide()

	# 相机跟随玩家
	var cam_target := _player.global_position
	var cam_pos := cam_target + Vector3(0, 6, 9)
	_camera.global_position = _camera.global_position.lerp(cam_pos, minf(delta * 5.0, 1.0))
	_camera.look_at(cam_target, Vector3.UP)

	# ---- 定时抓帧推流 ----
	_frame_accum += delta
	if _frame_accum >= 1.0 / FRAME_FPS:
		_frame_accum = 0.0
		_send_frame()


func _poll_socket() -> void:
	_ws.poll()
	match _ws.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			while _ws.get_available_packet_count() > 0:
				var pkt := _ws.get_packet()
				if _ws.get_packet_error() != OK:
					continue
				var text := pkt.get_string_from_utf8()
				_handle_message(text)
		WebSocketPeer.STATE_CLOSED:
			# 断线后每 3 秒重连
			_reconnect_timer += get_physics_process_delta_time()
			if _reconnect_timer > 3.0:
				_reconnect_timer = 0.0
				_connect_to_relay()


func _handle_message(text: String) -> void:
	var json := JSON.new()
	if json.parse(text) != OK:
		return
	var msg: Dictionary = json.data
	if msg.get("type") == "input":
		_input = Vector2(float(msg.get("x", 0.0)), float(msg.get("y", 0.0)))
		_input = _input.limit_length(1.0)


func _send_frame() -> void:
	if _ws.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return
	var img := get_viewport().get_texture().get_image()
	if img == null or img.is_empty():
		return
	var jpg := img.save_jpg_to_buffer(JPEG_QUALITY)
	if jpg.size() == 0:
		return
	_ws.send(jpg)
