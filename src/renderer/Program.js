import Class from '../core/Class';
import math from '../math/math';
import Cache from '../utils/Cache';
import log from '../utils/log';
import glType from './glType';
import extensions from './extensions';
import Shader from '../shader/Shader';
import constants from '../constants';

const GLSL300VertDefineCode = require('../shader/chunk/GLSL300Define.vert');
const GLSL300FragDefineCode = require('../shader/chunk/GLSL300Define.frag');

const {
    VERTEX_SHADER,
} = constants;

const cache = new Cache();

/**
 * @class
 */
const Program = Class.create(/** @lends Program.prototype */ {
    Statics: /** @lends Program */ {
        /**
         * 缓存
         * @type {Cache}
         * @readOnly
         * @return {Cache}
         */
        cache: {
            get() {
                return cache;
            }
        },
        /**
         * 重置缓存
         */
        reset(gl) { // eslint-disable-line no-unused-vars
            cache.each((program) => {
                program.destroy();
            });
        },
        /**
         * 获取程序
         * @param  {Shader} shader
         * @param  {WebGLState} state
         * @param  {Boolean} [ignoreError=false]
         * @return {Program}
         */
        getProgram(shader, state, ignoreError = false) {
            const id = shader.id;
            let program = cache.get(id);
            if (!program) {
                program = new Program({
                    state,
                    vertexShader: shader.vs,
                    fragShader: shader.fs,
                    ignoreError
                });
                cache.add(id, program);
            }

            return program;
        },

        /**
         * 获取空白程序
         * @param  {WebGLState} state
         * @return {Program}
         */
        getBlankProgram(state) {
            const shader = Shader.getCustomShader('void main(){}', 'precision HILO_MAX_FRAGMENT_PRECISION float;void main(){gl_FragColor = vec4(0.0);}', '', '__hiloBlankShader');
            return this.getProgram(shader, state, true);
        }
    },

    /**
     * @default Program
     * @type {String}
     */
    className: 'Program',

    /**
     * @default true
     * @type {Boolean}
     */
    isProgram: true,

    /**
     * 片段代码
     * @type {String}
     * @default ''
     */
    fragShader: '',

    /**
     * 顶点代码
     * @type {String}
     * @default ''
     */
    vertexShader: '',

    /**
     * attribute 集合
     * @type {Object}
     * @default null
     */
    attributes: null,

    /**
     * uniform 集合
     * @type {Object}
     * @default null
     */
    uniforms: null,

    /**
     * uniformBlock 集合
     * @type {Object}
     * @default null
     */
    uniformBlocks: null,

    /**
     * program
     * @type {WebGLProgram}
     * @default null
     */
    program: null,

    /**
     * gl
     * @type {WebGLRenderingContext}
     */
    gl: null,

    /**
     * webglState
     * @type {WebGLState}
     * @default null
     */
    state: null,

    /**
     * 是否始终使用
     * @default true
     * @type {Boolean}
     */
    alwaysUse: false,

    /**
     * 是否是 WebGL2
     * @default false
     * @type {Boolean}
     */
    isWebGL2: false,

    /**
     * @constructs
     * @param  {Object} [params] 初始化参数，所有params都会复制到实例上
     * @param  {WebGLState} params.state WebGL state
     */
    constructor(params) {
        /**
         * id
         * @type {String}
         */
        this.id = math.generateUUID(this.className);
        Object.assign(this, params);
        this._dict = {};


        this.attributes = {};
        this.uniforms = {};
        this.uniformBlocks = {};
        this.gl = this.state.gl;
        this.isWebGL2 = this.state.isWebGL2;
        this.program = this.createProgram();

        if (this.program) {
            this.initAttributes();
            this.initUniforms();
            return this;
        }

        if (this.ignoreError) {
            return this;
        }

        return Program.getBlankProgram(params.state);
    },

    /**
     * 生成 program
     * @return {WebGLProgram}
     */
    createProgram() {
        const gl = this.gl;
        const program = gl.createProgram();
        const vertexShader = this.createShader(gl.VERTEX_SHADER, this.vertexShader);
        const fragShader = this.createShader(gl.FRAGMENT_SHADER, this.fragShader);

        if (vertexShader && fragShader) {
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragShader);
            gl.linkProgram(program);
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragShader);

            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                const error = gl.getProgramInfoLog(program);
                log.error('compileProgramError: ' + error, this);
                gl.deleteProgram(program);
                return null;
            }

            return program;
        }

        return null;
    },
    /**
     * 使用 program
     */
    useProgram() {
        this.state.useProgram(this.program);
    },
    /**
     * 生成 shader
     * @param  {Number} shaderType
     * @param  {String} code
     * @return {WebGLShader}
     */
    createShader(shaderType, code) {
        if (this.isWebGL2) {
            code = this._convertToGLSL300(shaderType, code);
        }
        const gl = this.gl;
        const shader = gl.createShader(shaderType);
        gl.shaderSource(shader, code);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const error = gl.getShaderInfoLog(shader);
            log.error('compileShaderError: ' + error, code.split('\n').map((line, index) => `${index + 1} ${line}`).join('\n'));
            return null;
        }

        return shader;
    },
    _convertToGLSL300(shaderType, code) {
        let finalCode = code;
        if (shaderType === VERTEX_SHADER) {
            finalCode = GLSL300VertDefineCode + code;
        } else {
            finalCode = GLSL300FragDefineCode + code;
            finalCode = finalCode.replace(/gl_FragData\[(\d)\]/g, 'hilo_FragData$1');
        }

        return finalCode;
    },
    /**
     * 初始化 attribute 信息
     */
    initAttributes() {
        const gl = this.gl;
        const program = this.program;

        const num = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
        const instancedExtension = extensions.instanced;
        for (let i = 0; i < num; i++) {
            const {
                name,
                type,
                size
            } = gl.getActiveAttrib(program, i);
            const location = gl.getAttribLocation(program, name);
            const glTypeInfo = glType.get(type);
            let pointer = ({
                type = gl.FLOAT,
                normalized = false,
                stride = 0,
                offset = 0,
                size = glTypeInfo.size,
            }) => {
                gl.vertexAttribPointer(location, size, type, normalized, stride, offset);
            };
            let enable = () => {
                gl.enableVertexAttribArray(location);
            };
            let divisor = () => {};
            let addTo = (array, data) => {
                array[location] = data;
            };

            if (instancedExtension) {
                divisor = (d = 1) => {
                    instancedExtension.vertexAttribDivisor(location, d);
                };
            }

            if (glTypeInfo.type === 'Matrix') {
                const matrixStride = glTypeInfo.byteSize;
                const size = glTypeInfo.size;
                const matSize = Math.sqrt(size);
                const vectorByteSize = matSize * 4;

                const each = (callback) => {
                    for (let i = 0; i < matSize; i++) {
                        callback(location + i, i);
                    }
                };
                pointer = ({
                    type = gl.FLOAT,
                    normalized = false,
                    stride = 0,
                    offset = 0
                }) => {
                    let realStride;
                    if (stride === 0) {
                        realStride = matrixStride;
                    } else {
                        realStride = stride;
                    }
                    each((location, i) => {
                        gl.vertexAttribPointer(location, matSize, type, normalized, realStride, offset + vectorByteSize * i);
                    });
                };

                enable = () => {
                    each((location) => {
                        gl.enableVertexAttribArray(location);
                    });
                };

                addTo = (array, data) => {
                    each((location) => {
                        array[location] = data;
                    });
                };

                if (instancedExtension) {
                    divisor = (d = 1) => {
                        each((location) => {
                            instancedExtension.vertexAttribDivisor(location, d);
                        });
                    };
                }
            }
            this.attributes[name] = {
                name,
                location,
                type,
                size,
                glTypeInfo,
                pointer,
                enable,
                divisor,
                addTo
            };
        }
    },
    /**
     * 初始化 uniform 信息
     */
    initUniforms() {
        const gl = this.gl;
        const program = this.program;
        const uniforms = this.uniforms;
        const uniformBlocks = this.uniformBlocks;

        const num = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        let uniformBlockIndices;
        if (this.isWebGL2) {
            const blockNum = gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS);
            for (let i = 0; i < blockNum; i++) {
                const blockName = gl.getActiveUniformBlockName(program, i);
                const blockIndex = gl.getUniformBlockIndex(program, blockName);
                gl.uniformBlockBinding(program, blockIndex, i);
                uniformBlocks[blockName] = {
                    blockIndex,
                };
                Object.defineProperty(this, blockName, {
                    set: (uniformBuffer) => {
                        gl.bindBufferBase(gl.UNIFORM_BUFFER, i, uniformBuffer.getBuffer(gl).buffer);
                    }
                });
            }

            let uniformIndices = [];
            for (let i = 0; i < num; i++) {
                uniformIndices.push(i);
            }
            uniformBlockIndices = gl.getActiveUniforms(program, uniformIndices, gl.UNIFORM_BLOCK_INDEX);
        }

        let textureIndex = 0;
        for (let i = 0; i < num; i++) {
            let {
                name,
                size,
                type
            } = gl.getActiveUniform(program, i);

            // uniform block index -1 说明不是 uniform block
            if (uniformBlockIndices && uniformBlockIndices[i] !== -1) {
                continue;
            }

            name = name.replace(/\[0\]$/, '');
            const location = gl.getUniformLocation(program, name);
            const glTypeInfo = glType.get(type);
            const {
                uniformArray,
                uniform
            } = glTypeInfo;

            uniforms[name] = {
                name,
                location,
                type,
                size,
                glTypeInfo
            };

            if (type === gl.SAMPLER_2D || type === gl.SAMPLER_CUBE) {
                uniforms[name].textureIndex = textureIndex;
                textureIndex += size;
            }

            Object.defineProperty(this, name, {
                set: glTypeInfo.size > 1 || size > 1 ? (value) => {
                    uniformArray(location, value);
                } : (value) => {
                    if (this._dict[name] !== value) {
                        this._dict[name] = value;
                        uniform(location, value);
                    }
                }
            });
        }
    },
    /**
     * 没有被引用时销毁资源
     * @param  {WebGLRenderer} renderer
     * @return {Program} this
     */
    destroyIfNoRef(renderer) {
        const resourceManager = renderer.resourceManager;
        resourceManager.destroyIfNoRef(this);

        return this;
    },
    /**
     * 销毁资源
     * @return {Program} this
     */
    destroy() {
        if (this._isDestroyed) {
            return this;
        }

        this.gl.deleteProgram(this.program);
        this.uniforms = null;
        this.uniformBlocks = null;
        this.attributes = null;
        this.program = null;
        this.gl = null;
        this.state = null;
        this._dict = null;
        cache.removeObject(this);

        this._isDestroyed = true;
        return this;
    }
});

export default Program;
