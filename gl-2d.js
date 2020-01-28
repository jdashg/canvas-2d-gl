(() => {
   const GL = WebGLRenderingContext;

   // -

   const next_id = (() => {
      let prev_id = 0;
      return () => {
         prev_id += 1;
         return prev_id;
      };
   })();

   function obj_id(x) {
      if (!x._obj_id) {
         x._obj_id = next_id();
      }
      return x._obj_id;
   }

   // -

   function vec_dot(a, b) {
      var ret = 0;
      if (a.length !== b.length) throw new Error(`${a.length} !== ${b.length}`);
      for (var i = 0; i < a.length; i++) {
         ret += a[i]*b[i];
      }
      return ret;
   }

   function mat_row(m, row) {
      return m[row];
   }

   function mat_col(m, col) {
      let ret = [];
      for (var i = 0; i < m.length; i++) {
         ret.push(m[i][col]);
      }
      return ret;
   }

   function mat_mul(a, b) {
      const ret = [];
      for (let y = 0; y < a.length; y++) {
         const row = [];
         for (let x = 0; x < b[0].length; x++) {
            const val = vec_dot(mat_row(a, y), mat_col(b, x));
            row.push(val);
         }
         ret.push(row);
      }
      return ret;
   }

   function mat_mul_vec(a, b) {
      b = [b];
      b = mat_trans(b);
      return mat_mul(a, b);
   }

   function mat_string(m, precision) {
      precision = precision || 5;
      const rows = [];
      for (let i = 0; i < m.length; i++) {
         if (m[i].length !== m[0].length) throw new Error(`${m[i].length} !== ${m[0].length}`);
         const row = mat_row(m, i);
         const format = function(x) {
            let str = x.toFixed(precision);
            if (str[0] != '-')
               str = ' ' + str;
            return str;
         };
         const row_strs = row.map(format);
         const row_str = row_strs.join(',');
         rows.push(row_str);
      }
      const rows_str = '[' + rows.join(',\n ') + ' ]';
      return rows_str;
   }

   function mat_trans(m) {
      const n = m[0].length;
      const ret = [];
      for (let i = 0; i < n; i++) {
         ret.push(mat_col(m, i));
      }
      return ret;
   }

   function mat_ident(m_rows, n_cols) {
      n_cols = n_cols || m_rows;

      const ret = [];
      for (let y = 0; y < m_rows; y++) {
         const row = [];
         for (let x = 0; x < n_cols; x++) {
            let val = 0;
            if (x == y) {
               val = 1;
            }
            row.push(val);
         }
         ret.push(row);
      }
      return ret;
   }

   // -

   function create_c2d(w, h) {
      const elem = document.createElement('canvas');
      elem.width = w;
      elem.height = h;
      return elem.getContext('2d');
   }

   // -
   /*
   function hook_prop(obj, prop_name, override_desc) {
      const proto = Object.getPrototypeOf(obj);
      const proto_prop_desc = Object.getOwnPropertyDescriptor(proto, prop_name);
      const prop_desc = {};
      for (const k in proto_prop_desc) {
         prop_desc[k] = proto_prop_desc[k];
         if (override_desc[k]) {
            if (k == 'get' || k == 'set') {
               prop_desc[k] = function() {
                  const orig_fn = proto_prop_desc[k];
                  const new_args = [].concat([].slice.call(arguments), orig_fn);
                  console.log(new_args);
                  return override_desc[k].apply(this, new_args);
               };
            }
         }
      }
      Object.defineProperty(obj, prop_name, prop_desc);
   }
   */
   // -

   function hook_prop(obj, k, fn_observe, fn_override) {
      const desc = Object.getOwnPropertyDescriptor(obj, k);

      function hook(desc_key, k_name) {
         //console.log(`hook_prop: ${obj.constructor.name}.${k_name}`);
         const was = desc[desc_key];
         if (!was) return;
         desc[desc_key] = function() {
            if (fn_override) {
               const boxed_result = fn_override(this, k_name, was, arguments);
               if (boxed_result) return boxed_result[0];
            }

            const ret = was.apply(this, arguments);
            if (fn_observe) {
               fn_observe(this, k_name, arguments, ret);
            }
            return ret;
         };
      }

      hook('get', 'get ' + k);
      hook('set', 'set ' + k);
      if (typeof desc.value === 'function') {
         hook('value', k);
      }

      Object.defineProperty(obj, k, desc);
   }

   // -

   function on_width_height(obj, k, args, ret) {
      if (args.length != 1) return;
      const context = obj._gl2d_context;
      if (!context) return;
      if (!context._reset) return;
      context._reset();
   }
   hook_prop(HTMLCanvasElement.prototype, 'width', on_width_height);
   hook_prop(HTMLCanvasElement.prototype, 'height', on_width_height);

   // -

   function on_path_line_or_move(obj, pen_down, x, y) {
      obj._rects = null;
      if (obj._lines === null) return;
      if (obj._lines === undefined) {
         obj._lines = [];
      }

      if (pen_down) {
         const x0 = obj._lines.x || 0.0;
         const y0 = obj._lines.y || 0.0;
         obj._lines.push(x0, x0, x, y);
      }
      obj._lines.x = x;
      obj._lines.y = y;
   }

   function on_path_rect(obj, name, args, ret) {
      obj._lines = null;
      if (obj._rects === null) return;
      if (obj._rects === undefined) {
         obj._rects = [];
      }

      obj._rects.push(args[0], args[1], args[2], args[3]);
   }

   function on_path_line(obj, name, args, ret) {
      on_path_line_or_move(obj, true, args[0], args[1]);
   }
   function on_path_move(obj, name, args, ret) {
      on_path_line_or_move(obj, false, args[0], args[1]);
   }

   function on_path_unimplemented(obj, name, args, ret) {
      obj._lines = null;
      obj._rects = null;
   }

   for (const k in Path2D.prototype) {
      let hook = on_path_unimplemented;
      switch (k) {
         case 'lineTo':
            hook = on_path_line;
            break;
         case 'moveTo':
            hook = on_path_move;
            break;
         case 'rect':
            hook = on_path_rect;
            break;
      }
      hook_prop(Path2D.prototype, k, hook);
   }

   // -

   class Float32Vector {
      constructor(initial_capacity) {
         initial_capacity = initial_capacity || 1000;
         this.chunks = [];
         if (initial_capacity) {
            const chunk = new Float32Array(initial_capacity);
            this.chunks.push(chunk);
         }
         this.size = 0;
         this.avail = initial_capacity;
      }

      reset() {
         this.data(); // coalesce
         this.avail = this.size;
         this.size = 0;
      }

      set(src, src_offset, src_size) {
         src_offset = src_offset || 0;
         src_size = src_size || (src.length - src_offset);

         let dst_avail = this.avail;
         let chunk;
         if (src_size > dst_avail) { // split across chunks
            let next_size = 0;
            if (dst_avail) {
               chunk = this.chunks[this.chunks.length-1];

               let sub;
               if (src.subarray) {
                  sub = src.subarray(src_offset, src_offset + dst_avail);
               } else {
                  sub = src.slice(src_offset, src_offset + dst_avail);
               }

               chunk.set(sub, chunk.length - dst_avail);
               this.size += dst_avail;
               this.avail -= dst_avail;
               src_offset += dst_avail;
               src_size -= dst_avail;

               next_size = chunk.length * 3;
            }

            if (next_size < src_size) {
               next_size = src_size;
            }
            chunk = new Float32Array(next_size);
            this.chunks.push(chunk);
            this.avail += chunk.length;

            if (src.subarray) {
               src = src.subarray(src_offset);
            } else {
               src = src.slice(src_offset);
            }

            dst_avail = this.avail;
         }

         chunk.set(src, chunk.length - dst_avail);
         this.size += dst_avail;
         this.avail -= dst_avail;
      }

      data() {
         if (this.chunks.length != 1) {
            const data = new Float32Array(this.size + this.avail);
            let pos = 0;
            for (let x of this.chunks) {
               data.set(x, pos);
               pos += x.length;
            }
            this.chunks = [data];
         }
         let ret = this.chunks[0];
         if (this.avail) {
            ret = ret.subarray(0, ret.length - this.avail);
         }
         return ret;
      }
   };

   // -

   function array_equals(a, b) {
      if (a === b) return true;
      if (a.length != b.length) return false;
      let ret = true;
      for (const i in a) {
         ret &= a[i] == b[i];
      }
      return ret;
   }

   class RenderPass {
      constructor(type) {
         this.type = type;
      }

      equals(that) {
         if (this.type != that.type) return false;

         let ret = true;
         ret &= this.composite_op == that.composite_op;
         ret &= array_equals(this.color, that.color);
         ret &= this.tex == that.tex;
         ret &= array_equals(this.src_rect, that.src_rect);
         ret &= array_equals(this.line_info, that.line_info);
         return ret;
      }
   }

   class CommandBuffer {
      xyxy_data = new Float32Vector(1000);
      misc_data = new Float32Vector(1000);
      cmds = [];
      cur_pass = new RenderPass('none');
      cached_pass = null;
      last_pass = null;

      constructor() {
      }

      set composite_op(v) {
         this.cached_pass = null;
         this.cur_pass.composite_op = v;
      }
      set alpha(v) {
         this.cached_pass = null;
         this.cur_pass.composite_op = v;
      }

      fill(composite_op, color, tex, src_rect, prim_count) {
         let cmd = new CmdDraw('fill');
         cmd.composite_op = composite_op;
         cmd.color = color;
         cmd.tex = tex;
         cmd.src_rect = src_rect;



         if (cmd) {
            if (cmd.type == 'fill' && cmd.color == color && cmd.blend == blend &&
         if (!cmd) {

   };

   // -

   function make_rect(x_or_arr, y, w, h) {
      let x = x_or_arr;
      if (y === undefined) {
         const arr = x_or_arr;
         x = arr[0];
         y = arr[1];
         w = arr[2];
         h = arr[3];
      }
      return {x:x, y:y, w:w, h:h};
   }

   function abs_rect(rect) {
      if (rect.w < 0) {
         rect.x += rect.w;
         rect.w *= -1;
      }
      if (rect.h < 0) {
         rect.y += rect.h;
         rect.h *= -1;
      }
   }

   function scale_rect(rect, scaleX, scaleY) {
      rect.x *= scaleX;
      rect.y *= scaleY;
      rect.w *= scaleX;
      rect.h *= scaleY;
   }

   function flip_y(rect, height) {
      rect.y = height - (rect.y + rect.h);
   }

   function normalize_canvas_rect(rect, gl) {
      scale_rect(rect, 1.0 / gl.canvas.width, 1.0 / gl.canvas.height);
      flip_y(rect, 1.0);
   }

   // -

   function create_nomip_texture(gl) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      return tex;
   }

   // -

   function linkProgramSources(gl, vertSource, fragSource, bind_attribs) {
      bind_attribs = bind_attribs || [];

      const prog = gl.createProgram();

      function attachShaderSource(type, glsl) {
         glsl = glsl.trim() + '\n';

         const shader = gl.createShader(type);
         gl.shaderSource(shader, glsl);
         gl.compileShader(shader);
         gl.attachShader(prog, shader);
         return shader;
      }
      const vs = attachShaderSource(gl.VERTEX_SHADER, vertSource);
      const fs = attachShaderSource(gl.FRAGMENT_SHADER, fragSource);

      for (const i in bind_attribs) {
         const name = bind_attribs[i];
         gl.bindAttribLocation(prog, i, name);
      }

      gl.linkProgram(prog);

      const success = gl.getProgramParameter(prog, gl.LINK_STATUS);
      if (!success) {
         console.log('Error linking program: ' + gl.getProgramInfoLog(prog));
         console.log('\nVert shader log: ' + gl.getShaderInfoLog(vs));
         console.log('\nFrag shader log: ' + gl.getShaderInfoLog(fs));
         return null;
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);

      let count = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
      for (let i = 0; i < count; i++) {
         const info = gl.getActiveAttrib(prog, i);
         prog[info.name] = gl.getAttribLocation(prog, info.name);
      }
      count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < count; i++) {
         const info = gl.getActiveUniform(prog, i);
         prog[info.name] = gl.getUniformLocation(prog, info.name);
      }
      return prog;
   }

   function parse_color(style_str) {
      const arr = (function() {
         if (style_str[0] == '#') {
            const str = style_str.substring(1);
            const per_channel = (str.length <= 4) ? 1 : 2;
            const color = [0,0,0,0].map((x, i) => {
               let part = str.substring(per_channel*i, per_channel*(i+1));
               if (!part.length) {
                  part = 'f';
               }
               if (part.length == 1) {
                  part = part + part;
               }
               const ret = parseInt(part, 16);
               return ret / 255.0;
            });
            return color;
         }

         const re_rgba = /rgba?[(](.+)[)]/;
         const re_sep = / *[, \/] */g;
         const m = style_str.match(re_rgba);
         if (m) {
            const rgba_str = m[1];
            let arr = rgba_str.trim().split(re_sep);
            arr[3] = arr[3] || 1;
            arr = arr.map((x, i) => {
               if (x.endsWith('%')) {
                  x = x.substring(0, x.length-1);
                  return x / 100.0;
               }
               const scale = (i == 3 ? 1 : 255);
               return x / scale;
            });
            return arr;
         }

         throw new Error('Bad style_str: ' + style_str);
      })();
      arr[0] *= arr[3];
      arr[1] *= arr[3];
      arr[2] *= arr[3];
      return arr;
   }

   const IDENT_TRANSFORM = mat_ident(3, 3);

   const DRAW_STATE = {
      fillStyle               : '#000',
      font                    : '10px sans-serif',
      globalAlpha             : 1.0,
      globalCompositeOperation: 'source-over',
      imageSmoothingEnabled   : true,
      lineCap                 : 'butt',
      lineDashOffset          : 0.0,
      lineJoin                : 'miter',
      lineWidth               : 1.0,
      miterLimit              : 10.0,
      shadowBlur              : 0,
      shadowColor             : '#0000',
      shadowOffsetX           : 0,
      shadowOffsetY           : 0,
      strokeStyle             : '#000',
      textAlign               : 'start',
      textBaseline            : 'alphabetic',
      _transform              : IDENT_TRANSFORM,
      _line_dash              : [],
   };

   class CanvasRenderingContextGL2D {
      constructor(gl) {
         const c2d_canvas = document.createElement('canvas');
         c2d_canvas.width = gl.canvas.width;
         c2d_canvas.height = gl.canvas.height;
         const c2d = c2d_canvas.getContext('2d');
         //document.body.appendChild(c2d_canvas);

         this.gl = gl;
         this.c2d = c2d;

         const gl2d = this;

         for (const k in DRAW_STATE) {
            if (k[0] == '_')
               continue;
            Object.defineProperty(this, k, {
               enumerable: true,
               get: function() { return gl2d._state[k]; },
               set: function(val) {
                  //c2d[k] = val;
                  //console.log(`${k}: ${val} => ${c2d[k]}`);
                  gl2d._state[k] = val;
               },
            });
         }

         this._reset();

         // -

         const BLIT_VS = `
attribute vec2 a_vert;
uniform vec4 u_dest_rect;
uniform vec4 u_tex_rect;
varying vec2 v_tex_coord;

void main() {
   vec2 dest_pos = u_dest_rect.xy + a_vert * u_dest_rect.zw;
   gl_Position = vec4(dest_pos * 2.0 - 1.0, 0.0, 1.0);
   v_tex_coord = u_tex_rect.xy + a_vert * u_tex_rect.zw;
}`.trim();
         const BLIT_FS = `
precision mediump float;

uniform sampler2D u_tex;
varying vec2 v_tex_coord;

void main() {
    gl_FragColor = texture2D(u_tex, v_tex_coord);
}`.trim();
         this.blit_prog = linkProgramSources(gl, BLIT_VS, BLIT_FS, ['a_vert']);

         // -

         const RECT_VS = `
attribute vec2 a_box01;
attribute vec4 a_dest_rect;
attribute float a_order;
uniform mat3 u_transform;
uniform vec4 u_src_rect;
varying vec2 v_tex_coord;

void main() {
   vec2 dest2 = a_dest_rect.xy + a_box01 * a_dest_rect.zw;
   vec3 dest3 = u_transform * vec3(dest2, 1);
   gl_Position = vec4(dest3.xy * 2.0 - 1.0, 0.0, 1.0);
   gl_Position.y *= -1.0;
   gl_Position.z = -a_order;

   v_tex_coord = u_src_rect.xy + a_box01 * u_src_rect.zw;
}`.trim();
         const TEX_FS = `
precision mediump float;

uniform sampler2D u_sampler;
uniform vec4 u_color;
varying vec2 v_tex_coord;

void main() {
    gl_FragColor = texture2D(u_sampler, v_tex_coord);
    gl_FragColor *= u_color;
    //gl_FragColor.rg = (gl_FragColor.rg + v_tex_coord) / 2.0;
    //gl_FragColor.a = 1.0;
}`.trim();
         const LINE_VS = `
attribute vec2 a_box01;
attribute vec4 a_xy0xy1;
attribute float a_order;
uniform mediump vec4 u_line_info;
uniform mat3 u_transform;
varying vec2 v_line_coord;
varying float v_line_height;

void main() {
   float u_line_width = u_line_info.x;
   int u_line_cap = int(u_line_info.y);

   float half_w_len = u_line_width / 2.0;

   vec2 r = a_xy0xy1.xy;
   vec2 s = a_xy0xy1.zw;
   vec2 h = s - r;
   float h_len = length(h);
   vec2 h_dir = h / h_len;
   vec2 w_dir = cross(vec3(h_dir, 0), vec3(0, 0, 1)).xy;

   float cap_len = 0.0;
   if (u_line_cap != 0) {
      cap_len = half_w_len;
   }
   float capped_h_len = h_len + 2.0 * cap_len;
   r -= w_dir * half_w_len;
   r -= h_dir * cap_len;

   // Col-major: [ w.x , cap_h.x, r.x ]
   //            [ w.y , cap_h.y, r.y ]
   mat3 xy_from_wh = mat3(vec3(w_dir*u_line_width, 0), vec3(h_dir*capped_h_len, 0), vec3(r, 1));

   vec3 xy_pos = xy_from_wh * vec3(a_box01, 1);

   xy_pos = u_transform * xy_pos;
   gl_Position = vec4(xy_pos.xy * 2.0 - 1.0, 0.0, 1.0);
   gl_Position.y *= -1.0;
   gl_Position.z = -a_order;

   v_line_coord = vec2(-half_w_len, -cap_len) + a_box01 * vec2(u_line_width, capped_h_len);
   v_line_height = h_len;
}`.trim();
         const LINE_FS = `
precision mediump float;

uniform vec4 u_color;
uniform sampler2D u_dash_tex;
uniform vec4 u_line_info;

varying vec2 v_line_coord;
varying float v_line_height;

void main() {
   float u_line_width = u_line_info.x;
   int u_line_cap = int(u_line_info.y);
   float u_dash_length = u_line_info.z;
   float u_dash_offset = u_line_info.w;

   float dash_coord = (v_line_coord.y + u_dash_offset) / u_dash_length;
   dash_coord = mod(dash_coord, 1.0); // repeat
   float dash_dist_to_solid = texture2D(u_dash_tex, vec2(dash_coord, 0)).r * 255.0;

   float h_dist_to_solid = max(0.0 - v_line_coord.y, v_line_coord.y - v_line_height);
   h_dist_to_solid = max(h_dist_to_solid, dash_dist_to_solid);

   float dist_to_solid = h_dist_to_solid;
   float half_line_width = u_line_width/2.0;
   if (u_line_cap == 1) { // round
      dist_to_solid = length(vec2(v_line_coord.x, dist_to_solid));
      dist_to_solid = max(0.0, dist_to_solid - half_line_width);
   } else if (u_line_cap == 2) { // square
      dist_to_solid = max(0.0, dist_to_solid - half_line_width);
   }

   float solidness = max(0.0, 1.0 - dist_to_solid);
   if (solidness <= 0.0) discard;
   gl_FragColor = u_color * solidness;
}`.trim();
         this.rect_prog = linkProgramSources(gl, RECT_VS, TEX_FS, ['a_box01', 'a_dest_rect']);
         this.line_prog = linkProgramSources(gl, LINE_VS, LINE_FS, ['a_box01', 'a_xy0xy1']);

         this._white_tex = create_nomip_texture(gl);
         gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE,
                       new Uint8Array([255, 255, 255, 255]));

         // -

         gl.disable(GL.DEPTH_TEST);
         gl.enable(GL.BLEND);

         // -

         const vao_ext = gl.getExtension('OES_vertex_array_object');
         gl.createVertexArray = function() { return vao_ext.createVertexArrayOES(); };
         gl.bindVertexArray = function(vao) { return vao_ext.bindVertexArrayOES(vao); };

         this.blit_vao = gl.createVertexArray();
         gl.bindVertexArray(this.blit_vao);

         const vertData = [
             0, 0,
             1, 0,
             0, 1,
             1, 1,
         ];
         const vbo = gl.createBuffer();
         gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
         gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertData), gl.STATIC_DRAW);

         const instancing_ext = gl.getExtension('ANGLE_instanced_arrays');
         gl.drawArraysInstanced = function(...args) {
            instancing_ext.drawArraysInstancedANGLE(...args);
         };

         gl.enableVertexAttribArray(0);
         gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

         gl.enableVertexAttribArray(1);
         instancing_ext.vertexAttribDivisorANGLE(1, 1);

         //gl.bindVertexArray(null);
      }

      _ensure_prog_transform(prog, transform) {
         const gl = this.gl;
         transform = transform || this._state._transform;
         if (transform === undefined) throw new Error('`transform` required.');
         if (prog.last_transform === transform) return;
         prog.last_transform = transform;
         const mat3 = this._gl_transform(transform);
         //console.log('_ensure_prog_transform: mat3:', mat3);
         gl.uniformMatrix3fv(prog.u_transform, false, mat3);
      }

      get canvas() {
         return this.gl.canvas;
      }

      _reset() {
         const gl = this.gl;
         const c2d = this.c2d;
         c2d.canvas.width = gl.canvas.width;
         c2d.canvas.height = gl.canvas.height;

         gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

         this._clear_for_copy();

         this._state_stack = [];
         this._state = Object.assign({}, DRAW_STATE);
      }

      _clear_for_copy() {
         const gl = this.gl;
         gl.disable(GL.SCISSOR_TEST);
         gl.clearColor(0, 0, 0, 0);
         gl.clear(GL.COLOR_BUFFER_BIT);
      }

      _flush() {

      }

      // -

      save() {
         this._state_stack.push(this._state);
         this._state = Object.assign({}, this._state);
      }

      restore() {
         if (!this._state_stack.length)
            return;
         this._state = this._state_stack.pop();
      }

      // -

      transform(a, b, c, d, e, f) {
         const m = [[a, c, e],
                    [b, d, f],
                    [0, 0, 1]];
         this._state._transform = mat_mul(this._state._transform, m);
      }

      getTransform() {
         const cur = this._state._transform;
         return new DOMMatrix([cur[0][0], cur[0][1], 0, cur[0][2],
                               cur[1][0], cur[1][1], 0, cur[1][2],
                               0, 0, 1, 0,
                               0, 0, 0, 1]);
      }
      setTransform(a, b, c, d, e, f) {
         this._state._transform = IDENT_TRANSFORM;
         this.transform(a, b, c, d, e, f);
      }
      rotate(cw_rads) {
         const sin = Math.sin(-cw_rads)
         const cos = Math.cos(-cw_rads);
         this.transform(cos,sin, -sin,cos, 0,0);
      }
      scale(x, y) {
         this.transform(x,0, 0,y, 0,0);
      }
      translate(x, y) {
         this.transform(1,0, 0,1, x,y);
      }

      _gl_transform(rows) {
         if (rows === undefined) {
            rows = this._state._transform;
         }
         const kx = 1/this.canvas.width;
         const ky = 1/this.canvas.height;
         const scale_mat = [[kx, 0, 0],
                            [0, ky, 0],
                            [0,  0, 1]];
         const scaled_rows = mat_mul(scale_mat, rows);

         const ret = new Float32Array(9);
         ret[0] = scaled_rows[0][0];
         ret[1] = scaled_rows[1][0];
         ret[2] = 0;
         ret[3] = scaled_rows[0][1];
         ret[4] = scaled_rows[1][1];
         ret[5] = 0;
         ret[6] = scaled_rows[0][2];
         ret[7] = scaled_rows[1][2];
         ret[8] = 1;
         return ret;
      }

      // -

      setLineDash(arr) {
         this._state._line_dash = arr.slice();
      }
      getLineDash() {
         return this._state._line_dash.slice();
      }

      // -

      measureText() {
         const c2d = this.c2d;
         c2d.font = this._state.font;
         c2d.textAlign = this._state.textAlign;
         c2d.textBaseline = this._state.textBaseline;
         return c2d.measureText(arguments);
      }

      createLinearGradient() {
         return this.c2d.createLinearGradient(arguments);
      }

      createRadialGradient() {
         return this.c2d.createRadialGradient(arguments);
      }

      // -

      _default_path = new Path2D();

      // -

      beginPath() {
         this._default_path = new Path2D();
      }

      arc() {
         console.error('unimplemented');
      }
      arcTo() {
         console.error('unimplemented');
      }
      bezierCurveTo() {
         console.error('unimplemented');
      }
      quadraticCurveTo() {
         console.error('unimplemented');
      }
      ellipse() {
         console.error('unimplemented');
      }

      closePath() {
         this._default_path.closePath();
      }
      lineTo(x, y) {
         let pos = [x, y, 1];
         pos = mat_mul_vec(this._state._transform, pos);
         this._default_path.lineTo(pos[0], pos[1]);
      }
      moveTo(x, y) {
         let pos = [x, y, 1];
         pos = mat_mul_vec(this._state._transform, pos);
         this._default_path.moveTo(pos[0], pos[1]);
      }
      rect(x, y, w, h) {
         const cur = this._state._transform;
         if (cur[0][1] == 0.0 && cur[1][0] == 0.0) {
            let pos = [x, y, 1];
            let size = [w, h, 0];
            pos = mat_mul_vec(this._state._transform, pos);
            size = mat_mul_vec(this._state._transform, size);
            this._default_path.rect(pos[0], pos[1], size[0], size[1]);
            return;
         }

         // TODO: Handle rotate/skew transfers per-rect.

         // Shim out to move/line:
         this.moveTo(x, y);
         this.lineTo(x+w, y);
         this.lineTo(x+w, y+h);
         this.lineTo(x, y+h);
         this.closePath();
      }

      // -

      _path_float_buf = new Float32Array(1000);

      _path_float_buf_push(arr) {
         let buf = this._path_float_buf;
         const pos = buf.pos;
         const end = pos + arr.length;
         if (end > buf.length) {
            const old = buf;
            buf = this._path_float_buf = new Float32Array(old.length * 2);
            buf.set(old);
         }
         buf.set(arr, pos);
         buf.pos = end;
      }

      // -

      fill(a1, a2) {
         let filL_rule, path;
         if (a2 === undefined) {
            path = this._default_path;
            filL_rule = a1;
         } else {
            path = a1;
            filL_rule = a2;
         }

         filL_rule = filL_rule || 'nonzero';

         // -

         if (filL_rule == 'nonzero') {
            if (this._fill_fast()) return;
         }
         console.error('unimplemented');
      }

      stroke(path) {
         path = path || this._default_path;
         if (this._stroke_fast(path)) return;
         console.error('unimplemented');
      }

      // -

      _fill_fast() {
         const cur_path = this._default_path;
         if (!cur_path.length) return true; // Ok, sure!

         this._path_float_buf.pos = 0;

         const common_transform = cur_path[0].transform;
         for (const cur of cur_path) {
            if (cur.transform !== common_transform) {
               console.log(`Can't fast-path with dynamic transform.`);
               return false;
            }

            if (cur.func === 'rect') {
               if (cur.args.length != 4) throw new Error(`Arg count must be 4: ${cur.args}`);
               this._path_float_buf_push(cur.args);
               continue;
            }

            console.log(`Can't fast-path ${cur.func}().`);
            return false;
         }
         const buf_end = this._path_float_buf.pos;
         const sub_buf = this._path_float_buf.subarray(0, buf_end);

         // -

         const gl = this.gl;
         const prog = this.rect_prog;
         gl.useProgram(prog);
         this._ensure_prog_transform(prog, common_transform);
         this._ensure_blend_op();

         const c2d = this.c2d;
         c2d.fillStyle = this.fillStyle;
         const color = parse_color(c2d.fillStyle);
         //console.log('_fill_rects: color: ', color);
         if (!color) throw new Error('Bad fillStyle: ' + this.fillStyle);

         color[0] *= this.globalAlpha;
         color[1] *= this.globalAlpha;
         color[2] *= this.globalAlpha;
         color[3] *= this.globalAlpha;

         gl.uniform4fv(prog.u_color, color);
         gl.uniform4f(prog.u_src_rect, 0, 0, 1, 1);
         gl.bindTexture(GL.TEXTURE_2D, this._white_tex);

         gl.clear(gl.DEPTH_BUFFER_BIT);
         gl.enable(gl.DEPTH_TEST);

         this._draw_rects(sub_buf);

         gl.clear(gl.DEPTH_BUFFER_BIT);
         gl.disable(gl.DEPTH_TEST);
      }

      _draw_rects(rect_view) {
         const gl = this.gl;
         const vbo = gl.createBuffer();
         gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
         gl.bufferData(gl.ARRAY_BUFFER, rect_view, gl.STREAM_DRAW);
         gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);

         const quad_count = rect_view.length / 4;
         gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, quad_count);
         gl.deleteBuffer(vbo);
      }


      // -

      _cached_tex_by_line_dash = {}

      _tex_by_line_dash() {
         const gl = this.gl;

         const arr = this.getLineDash();
         const key = arr.join(',');

         let tex = this._cached_tex_by_line_dash[key];
         if (!tex) {
            tex = this._cached_tex_by_line_dash[key] = create_nomip_texture(gl);
            let bytes;
            if (arr.length) {
               let dash_length = 0;
               for (const sublen of arr) {
                  dash_length += sublen;
               }
               bytes = new Uint8Array(dash_length);
               let pos = 0;
               let pen_down = true;
               for (const sublen of arr) {
                  const end = pos + sublen;
                  if (pen_down) {
                     bytes.fill(0, pos, end);
                     pos = end;
                  } else {
                     const last_solid_pos = pos-1;
                     const next_solid_pos = end;
                     for (; pos < end; ++pos) {
                        const dist = Math.min(pos - last_solid_pos, next_solid_pos - pos);
                        bytes[pos] = dist;
                     }
                  }
                  pen_down = !pen_down;
               }
            } else {
               bytes = new Uint8Array([0]);
            }
            //console.log(`_tex_by_line_dash: [${arr}] => [${bytes}]`);
            tex.dash_length = bytes.length;
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, tex.dash_length, 1, 0,
                          gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes);
         }
         return tex;
      }

      _LINE_CAP_MODE_BY_STR = {
         'butt': 0,
         'round': 1,
         'square': 2,
      };


      fillStyle               : '#000',
      font                    : '10px sans-serif',
      globalAlpha             : 1.0,
      globalCompositeOperation: 'source-over',
      imageSmoothingEnabled   : true,
      lineCap                 : 'butt',
      lineDashOffset          : 0.0,
      lineJoin                : 'miter',
      lineWidth               : 1.0,
      miterLimit              : 10.0,
      shadowBlur              : 0,
      shadowColor             : '#0000',
      shadowOffsetX           : 0,
      shadowOffsetY           : 0,
      strokeStyle             : '#000',
      textAlign               : 'start',
      textBaseline            : 'alphabetic',
      _transform              : IDENT_TRANSFORM,
      _line_dash              : [],

      _stroke_fast(path) {
         let line_cap = this.lineCap;
         const line_join = this.lineJoin;

         let can_join = (line_cap == 'round' && line_join == 'round');
         if (path._rects) {
            if (line_join == 'miter') {
               line_cap = 'square';
               can_join = true;
            } else if (line_join == 'round') {
               line_cap = 'round';
               can_join = true;
            }
         }
         if (can_join) {
            console.log(`Can't join lines with lineCap:'${this.lineCap}', lineJoin:${this.lineJoin}'.`);
            return false;
         }

         if (path._rects && !path._lines) {
            const rects = path._rects;
            const rect_count = rects.length / 4;
            const lines = path._lines = Array(rect_count * 8);
            let src_itr = 0;
            let dst_itr = 0;
            while (src_itr < rects.length) {
               const x = rects[src_itr++];
               const y = rects[src_itr++];
               const w = rects[src_itr++];
               const h = rects[src_itr++];

               lines[dst_itr++] = x;
               lines[dst_itr++] = y;
               lines[dst_itr++] = x+w;
               lines[dst_itr++] = y;
               lines[dst_itr++] = x+w;
               lines[dst_itr++] = y+h;
               lines[dst_itr++] = x;
               lines[dst_itr++] = y+h;
            }
         }

         const c2d = this.c2d;

         const rp = new RenderPass('stroke');
         c2d.strokeStyle = this.strokeStyle;
         rp.style = c2d.strokeStyle;

         const lines = path._lines;
         if (!lines) return false;

         const cbuf = this._cbuf;






      }


      _stroke_fast() {
         const cur_path = this._default_path;
         if (!cur_path.length) return; // Ok, sure!

         this._path_float_buf.pos = 0;

         const common_transform = cur_path[0].transform;
         let fast = true;
         const path_pos = {
            x: 0,
            y: 0,
         };

         let needs_join = false;
         function move_to(x, y) {
            path_pos.x = x;
            path_pos.y = y;
            needs_join = false;
         }

         const root = this;
         function line_to(x, y, right_angles) {
            if (needs_join) {
               let can_join = (root.lineCap == "round" && root.lineJoin == "round");
               if (right_angles) {
                  can_join |= root.lineJoin == 'miter';
                  // Todo implement miter&&right_angles as lineCap:square.
               }
               if (!can_join) {
                  console.log(`Can't join lines with lineCap:'${root.lineCap}', lineJoin:${root.lineJoin}'.`);
                  return false;
               }
            }
            root._path_float_buf_push([path_pos.x, path_pos.y, x, y]);
            path_pos.x = x;
            path_pos.y = y;
            needs_join = true;
            return true;
         }

         for (const cur of cur_path) {
            if (cur.transform !== common_transform) {
               console.log(`Can't fast-path with dynamic transform.`);
               return false;
            }

            if (cur.func === 'moveTo') {
               move_to(cur.args[0], cur.args[1]);
               continue;
            }
            if (cur.func === 'lineTo') {
               if (!line_to(cur.args[0], cur.args[1])) return false;
               continue;
            }
            if (cur.func === 'rect') {
               const [x, y, w, h] = cur.args;
               move_to(x, y);
               if (!line_to(x+w, y, true) ||
                   !line_to(x+w, y+h, true) ||
                   !line_to(x, y+h, true) ||
                   !line_to(x, y, true)) {
                  return false;
               }
               continue;
            }

            console.log(`Can't fast-path ${cur.func}().`);
            return false;
         }

         const buf_end = this._path_float_buf.pos;
         const sub_buf = this._path_float_buf.subarray(0, buf_end);

         // -

         const gl = this.gl;
         const prog = this.line_prog;
         gl.useProgram(prog);
         this._ensure_prog_transform(prog, common_transform);
         this._ensure_blend_op();

         const dash_tex = this._tex_by_line_dash();
         gl.bindTexture(gl.TEXTURE_2D, dash_tex);

         const line_cap_mode = this._LINE_CAP_MODE_BY_STR[this.lineCap];
         if (line_cap_mode === 'undefined') throw new Error(`Bad lineCap: ${this.lineCap}`);

         gl.uniform4f(prog.u_line_info, this.lineWidth, line_cap_mode,
                      dash_tex.dash_length, this.lineDashOffset);

         const c2d = this.c2d;
         c2d.strokeStyle = this.strokeStyle;
         const color = parse_color(c2d.strokeStyle);
         //console.log('_fill_rects: color: ', color);
         if (!color) throw new Error('Bad strokeStyle: ' + this.strokeStyle);
         gl.uniform4fv(prog.u_color, color);

         gl.clear(gl.DEPTH_BUFFER_BIT);
         gl.enable(gl.DEPTH_TEST);

         this._draw_rects(sub_buf);

         gl.clear(gl.DEPTH_BUFFER_BIT);
         gl.disable(gl.DEPTH_TEST);
      }

      // -

      clip(a1, a2) {
         let fillRule, path;
         if (a2 === undefined) {
            path = this._default_path;
            fillRule = a1;
         } else {
            path = a1;
            fillRule = a2;
         }

         // -
         // fill stencil plane

         const gl = this.gl;

         let stencil_op;
         switch (fillRule) {
         case 'evenodd':
            stencil_op = gl.INVERT;
            break;

         case 'nonzero':
         default:
            stencil_op = gl.REPLACE;
            break;
         }

         gl.clear(gl.STENCIL_BUFFER_BIT);
         gl.colorMask(false, false, false, false);
         gl.stencilFunc(gl.ALWAYS, 1, 0);
         gl.stencilOp(stencil_op, stencil_op, stencil_op);

         this.fill(path, 'nonzero');

         // -
         // set stencil func/op for rendering

         gl.colorMask(true, true, true, true);
         gl.stencilFunc(gl.EQUALS, 1, 1);
         gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      }

      // -
/*
      createPattern(image, repetition) {
         repetition = repetition || 'repeat';

         const gl = this.gl;

         const tex = create_nomip_texture(gl);
         const width = image.width;
         const height = image.height;
         let border = 0;
         if (repetition == 'no-repeat') {
         gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
*/
      // -

      _cur_blend_op = undefined;

      _ensure_blend_op(blend_op) {
         blend_op = blend_op || this.globalCompositeOperation;
         if (blend_op == 'copy') {
            this._clear_for_copy();
         }
         if (blend_op === this._cur_blend_op) return;
         this._cur_blend_op = blend_op;

         const gl = this.gl;
         if (blend_op == 'source-over' ||
             blend_op == 'copy') {
            gl.blendEquation(gl.FUNC_ADD);
            //gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            return;
         }
         if (blend_op == 'destination-out') {
            gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
            gl.blendFunc(gl.ONE, gl.ONE);
            return;
         }

         if (blend_op == 'source-in') {
            // C = Cs
            // A = As*Ad
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.DST_ALPHA, gl.ZERO);
            return;
         }
         if (blend_op == 'destination-atop') {
            // C = Cd*Ad + Cs*(1-Ad)
            // A = As
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.DST_ALPHA, gl.ONE, gl.ZERO);
            return;
         }
         if (blend_op == 'lighter') {
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ONE, gl.ONE);
            return;
         }
         console.log('Unhandled blend_op: ', blend_op);
      }

      // -

      fillText(text, x, y, max_width) {
         this._put_text('fill', text, x, y, max_width);
      }
      strokeText(text, x, y, max_width) {
         this._put_text('stroke', text, x, y, max_width);
      }

      _make_text(type, text, x, y, max_width) {
         //console.log(`_put_text(${[].slice.call(arguments)})`);
         const c2d = this.c2d;
         const gl = this.gl;
         //console.log(`_put_text: font: ${c2d.font}`);

         // -
         // Measure-text

         c2d.font = this.font;
         c2d.textAlign = this.textAlign;
         c2d.textBaseline = this.textBaseline;
         const meas = c2d.measureText(text);

         // first: align:left, baseline:middle
         if (meas.actualBoundingBoxAscent === undefined) {
            // Guess time
            const em = c2d.measureText('M').width;
            const height = em * 1.5;
            switch (this.textBaseline) {
               case 'top':
                  meas.actualBoundingBoxAscent = 0;
                  break;
               case 'middle':
                  meas.actualBoundingBoxAscent = em / 2;
                  break;
               case 'alphabetic':
               case 'ideographic':
                  meas.actualBoundingBoxAscent = em;
                  break;
               case 'bottom':
                  meas.actualBoundingBoxAscent = height;
                  break;
            }
            meas.actualBoundingBoxDescent = height - meas.actualBoundingBoxAscent;
         }
         meas.height = meas.actualBoundingBoxAscent + meas.actualBoundingBoxDescent;
         //console.log('meas', meas);

         // -
         // put (composite:copy) on intermediary (cached?) canvas
         c2d.canvas.width = meas.width;
         c2d.canvas.height = meas.height; // This resets, so reset font et al

         c2d.font = this.font;
         c2d.textAlign = this.textAlign;
         c2d.textBaseline = this.textBaseline;

         c2d.globalCompositeOperation = 'copy';
         c2d.globalAlpha = 1.0;
         c2d.fillStyle = this.fillStyle;
         c2d.strokeStyle = this.strokeStyle;

         let func = c2d.fillText;
         if (type === 'stroke') {
            func = c2d.strokeText;
         }
         func.call(c2d, text, 0, meas.actualBoundingBoxAscent, max_width);

         // -
         // this.drawImage
         //const image = make_gl_image(this.gl, c2d.canvas, 0, meas.actualBoundingBoxAscent);
         const tex = create_nomip_texture(gl);

         gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
         gl.texImage2D(GL.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c2d.canvas);
         gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

         tex.width = meas.width;
         tex.height = meas.height;
         tex.y_offset = meas.actualBoundingBoxAscent;
         return tex;
      }

      _put_text(type, text, x, y, max_width) {
         const c2d = this.c2d;
         let key = {
            font: c2d.font,
            textAlign: c2d.textAlign,
            textBaseline: c2d.textBaseline,
            type: type,
            max_width: max_width,
            text: text,
         };
         key = JSON.stringify(key);
         //console.log('key', key);

         let tex = this._tex_cache[key];
         let should_update = false;
         if (!tex) {
            tex = this._tex_cache[key] = this._make_text(...arguments);
         }

         const d_rect = {
            x: x,
            y: y - tex.y_offset,
            w: tex.width,
            h: tex.height,
         };
         //console.log(d_rect);

         // -

         this._draw_tex_rect(tex, null, d_rect);
      }

      // -

      fillRect(x, y, w, h) {
         const cur_path = this._default_path;
         this.beginPath();
         this.rect(x, y, w, h);
         this.fill();
         this._default_path = cur_path;
      }

      strokeRect(x, y, w, h) {
         const cur_path = this._default_path;
         this.beginPath();
         this.rect(x, y, w, h);
         this.stroke();
         this._default_path = cur_path;
      }

      clearRect(x, y, w, h) {
         this.save();
         this.fillStyle = 'white';
         this.globalCompositeOperation = 'destination-out';
         this.fillRect(x, y, w, h);
         this.restore();
      }

      getImageData(x, y, w, h) {
         const c2d = this.c2d;
         const gl = this.gl;
         const canvas = gl.canvas;

         const gl_rect = make_rect(arguments);
         abs_rect(gl_rect);
         flip_y(gl_rect, gl.canvas.height);

         const p = new Uint8Array(gl_rect.w * gl_rect.h * 4);
         gl.readPixels(gl_rect.x, gl_rect.y, gl_rect.w, gl_rect.h, gl.RGBA, gl.UNSIGNED_BYTE, p);

         const idata = c2d.createImageData(w, h);
         const bytes_per_row = 4*gl_rect.w;
         for (let gl_row = 0; gl_row < gl_rect.h; ++gl_row) { // yflip
            const gl_start = bytes_per_row*gl_row;
            const id_start = bytes_per_row*(gl_rect.h - 1 - gl_row);
            idata.data.set(p.subarray(gl_start, gl_start + bytes_per_row), id_start);
         }
         return idata;
      }
/*
      putImageData(idata, dstX, dstY, srcX, srcY, w, h) {
         if (!idata.tex_by_canvas) {
            idata.tex_by_canvas = {};
         }
         if (!idata.tex_by_canvas[obj_id(this)]) {
            const gl = this.gl;
            idata.tex_by_canvas[obj_id(this)] = create_nomip_texture(gl);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, idata);
         }
         const tex = idata.tex_by_canvas[obj_id(this)];
         const fetchMatrix = make_fetch_mat(idata.width, idata.height,
      }
      */

      _tex_cache = {};

      drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh) {
         const gl = this.gl;
         const src_w = src.naturalWidth || src.videoWidth || src.width;
         const src_h = src.naturalHeight || src.videoHeight || src.height;

         if (dx === undefined) {
            dx = sx;
            dy = sy;
            dw = sw;
            dh = sh;

            sx = 0;
            sy = 0;
            sw = src_w;
            sh = src_h;
         }
         if (dw === undefined) {
            dw = sw;
            dh = sh;
         }

         // -

         const src_id = obj_id(src);

         let tex = this._tex_cache[src_id];
         let should_update = false;
         if (!tex) {
            tex = this._tex_cache[src_id] = create_nomip_texture(gl);
            should_update = true;
         } else {
            let is_static = src._is_static;
            if (is_static === undefined) {
               is_static = false; // Video/Canvas
               if (src instanceof HTMLImageElement) {
                  src.addEventListener('load', e => {
                     src._is_static = undefined;
                  }, false);

                  is_static = true;

                  const src_url = src.currentSrc || src.src;
                  if (src.currentSrc.endsWith('.gif')) {
                     is_static = false;
                  }
               }
               src._is_static = is_static;
            }
            should_update = !is_static;
         }

         if (should_update) {
            gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(GL.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
            gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
         }

         const s_norm_rect = {
            x: sx / src_w,
            y: sy / src_h,
            w: sw / src_w,
            h: sh / src_h,
         };
         const d_rect = {
            x: dx,
            y: dy,
            w: dw,
            h: dh,
         };

         // -

         this._draw_tex_rect(tex, s_norm_rect, d_rect);
      }

      /* _draw_tex_rect callers:
       * * drawImage
       * * fillText/strokeText
       * * putImageData
       */
      _draw_tex_rect(tex, s_norm_rect, d_rect) {
         s_norm_rect = s_norm_rect || {
            x: 0, y: 0,
            w: 1, h: 1,
         };

         const gl = this.gl;

         const prog = this.rect_prog;
         gl.useProgram(prog);
         gl.uniform4f(prog.u_color, this.globalAlpha, this.globalAlpha,
                      this.globalAlpha, this.globalAlpha);
         gl.uniform4f(prog.u_src_rect, s_norm_rect.x, s_norm_rect.y,
                      s_norm_rect.w, s_norm_rect.h);
         gl.bindTexture(GL.TEXTURE_2D, tex);

         this._ensure_blend_op();
         this._ensure_prog_transform(prog);

         const rect_view = new Float32Array([
            d_rect.x, d_rect.y, d_rect.w, d_rect.h,
         ]);
         this._draw_rects(rect_view);
      }
   }

   const orig_get_context = HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext = function(type, attribs) {
      let ret = null;
      if (type == 'gl-2d') {
         attribs = attribs || {
            alpha: true,
            antialias: true,
            depth: true,
            stencil: true,
            preserveDrawingBuffer: true,
            premultipliedAlpha: true,
         };
         const gl_canvas = this;
         const gl = orig_get_context.call(gl_canvas, 'webgl', attribs);
         if (!gl)
            return null;

         ret = new CanvasRenderingContextGL2D(gl);
      }
      if (!ret) {
         ret = orig_get_context.apply(this, arguments);
      }
      this._gl2d_context = ret;
      return ret;
   };
})();
