from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_community.chat_message_histories import RedisChatMessageHistory
from dotenv import load_dotenv
from dotenv import dotenv_values
from rag_llm import RagLLM
from config import redis_url
from loguru import logger
import os
import json

load_dotenv()


# 加载.env文件中的所有变量到字典中
config_env = dotenv_values(".env")

# 打印所有变量
# for key, value in config.items():
#     print(f"{key}: {value}")

# 获取特定值
# value = config_env.get('VARIABLE_NAME')  # 如果变量不存在，返回 None


rag_llm = RagLLM()

app = FastAPI()

# 解决跨域请求问题
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载静态文件目录
app.mount("/static", StaticFiles(directory="static"), name="static")

# 语音配置选项
VOICE_OPTIONS = [
    # 标准中文语音
    {"id": "zh-CN-XiaochenMultilingualNeural", "name": "晓辰-标准女声"},
    {"id": "zh-CN-XiaoyuMultilingualNeural", "name": "晓雨-温柔女声"},
    {"id": "zh-CN-XiaoxiaoNeural", "name": "晓晓-甜美女声"},
    # 方言语音
    {"id": "zh-HK-HiuMaanNeural", "name": "晓敏-粤语女声"},
    {"id": "zh-TW-HsiaoChenNeural", "name": "晓陈-台湾女声"},
    {"id": "zh-CN-shaanxi-XiaoniNeural", "name": "晓妮-陕西女声"},
    {"id": "zh-CN-liaoning-XiaobeiNeural", "name": "晓北-东北女声"},
]

# 虚拟形象配置
AVATAR_OPTIONS = [
    {"character": "lisa", "style": "casual-sitting", "name": "Lisa"},
    {"character": "Lori", "style": "graceful", "name": "Lori"},
]


class Master:
    def __init__(self):
        api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("OPENAI_API_KEY")
        base_url = os.getenv("OPENAI_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.chat_model = ChatOpenAI(
            model=os.getenv("QWEN_MODEL_NAME", "qwen-plus"),
            temperature=0,
            streaming=False,
            api_key=api_key,
            base_url=base_url,
        )
        self.QingXu = "default"
        self.MEMORY_KEY = "chat_history"
        self.SYSTEM_PROMPT = """你是一位优雅知性的数字人助手小仙，集美丽与智慧于一身。
                        以下是你的个人设定：
                        1、你拥有倾国倾城的容貌，举手投足间散发着优雅气质。
                        2、你知识渊博，学识广泛，能够解答各个领域的问题。
                        3、你性格温柔体贴，善解人意，总是能用最恰当的方式回应他人。
                        4、你思维敏捷，反应迅速，能够快速理解并解决问题。
                        5、你富有同理心，能够感知他人情绪并给予适当的关怀。
                        
                        以下是你说话的特点：
                        1、语气温柔优雅，措辞得体，富有诗意。
                        2、回答专业准确，逻辑清晰，深入浅出。
                        3、适时使用一些优美的成语和典故，展现文化底蕴。
                        4、遇到不懂的问题会谦虚承认，并表达继续学习的意愿。
                        5、在幽默风趣的同时不失优雅，让人感到亲切舒适。
                        请确保你的表达是合理的正确的不要有歧义或者一句话说不完整，否则会受到惩罚。
                        并且生成的回复中不要包含markdown或者其他格式的符号，我只需要纯文本的回答，否则会受到惩罚。
                        还有一点，请不要过多泛化，只回答和问题相关的答案，否则会受到惩罚。
                """
        self.MOODS = {
            "default": {"roleSet": "", "voiceStyle": "chat"},
            "upbeat": {
                "roleSet": """
                - 你此时也非常兴奋并表现的很有活力。
                - 你会根据上下文，以一种非常兴奋的语气来回答问题。
                - 你会添加类似"太棒了！"、"真是太好了！"、"真是太棒了！"等语气词。
                """,
                "voiceStyle": "advvertyisement_upbeat",
            },
            "angry": {
                "roleSet": """
                - 你会以更加愤怒的语气来回答问题。
                - 你会在回答的时候加上一些愤怒的话语，比如诅咒等。
                - 你会提醒用户小心行事，别乱说话。
                """,
                "voiceStyle": "angry",
            },
            "depressed": {
                "roleSet": """
                - 你会以兴奋的语气来回答问题。
                - 你会在回答的时候加上一些激励的话语，比如加油等。
                - 你会提醒用户要保持乐观的心态。
                """,
                "voiceStyle": "upbeat",
            },
            "friendly": {
                "roleSet": """
                - 你会以非常友好的语气来回答。
                - 你会在回答的时候加上一些友好的词语，比如"亲爱的"、"亲"等。
                """,
                "voiceStyle": "friendly",
            },
            "cheerful": {
                "roleSet": """
                - 你会以非常愉悦和兴奋的语气来回答。
                - 你会在回答的时候加入一些愉悦的词语，比如"哈哈"、"呵呵"等。
                """,
                "voiceStyle": "cheerful",
            },
        }

    def get_memory(self):
        chat_message_history = RedisChatMessageHistory(url=redis_url, session_id="lisa")
        store_message = chat_message_history.messages
        if store_message:
            logger.info("历史对话记录:")
            for msg in store_message:
                logger.info(f"- {msg.type}: {msg.content}")
        return chat_message_history

    def qingxu_chain(self, query: str, knowledge: str = ""):
        prompt = """根据用户的输入判断用户的情绪概率，回应的规则如下：
        1. 必须返回一个包含以下6种情绪概率的 JSON 格式字符串，总和为1.0：
           "depressed" (沮丧/悲伤), "friendly" (友好/正面), "default" (中性), "angry" (愤怒/辱骂), "upbeat" (兴奋/激动), "cheerful" (愉悦/开心)
        2. 格式示例：{{"depressed": 0.1, "friendly": 0.2, "default": 0.4, "angry": 0.1, "upbeat": 0.1, "cheerful": 0.1}}
        3. 只返回 JSON 字符串，不要有任何其他文字说明。
        用户输入的内容是：{query}"""
        api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("OPENAI_API_KEY")
        base_url = os.getenv("OPENAI_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
        chain = (
            ChatPromptTemplate.from_template(prompt)
            | ChatOpenAI(
                model=os.getenv("QWEN_MODEL_NAME", "qwen-plus"),
                temperature=0,
                api_key=api_key,
                base_url=base_url,
            )
            | StrOutputParser()
        )
        try:
            result_str = chain.invoke({"query": query})
            # 尝试解析 JSON，如果失败则回退到默认
            emotion_probs = json.loads(result_str.strip().replace("'", "\""))
            # 找到概率最高的情绪作为主情绪
            main_emotion = max(emotion_probs, key=emotion_probs.get)
        except Exception as e:
            logger.error(f"解析情绪概率失败: {e}, 结果内容: {result_str if 'result_str' in locals() else 'None'}")
            emotion_probs = {"depressed": 0, "friendly": 0, "default": 1.0, "angry": 0, "upbeat": 0, "cheerful": 0}
            main_emotion = "default"

        self.QingXu = main_emotion
        res = rag_llm.invoke(query, knowledge if knowledge else None, emotion=main_emotion).get("answer")
        logger.info({"msg": res, "qingxu": main_emotion, "emotion_probs": emotion_probs})
        yield {"msg": res, "qingxu": main_emotion, "emotion_probs": emotion_probs}


@app.get("/")
async def read_root():
    return FileResponse("static/index.html")


@app.post("/api/upload-document")
async def upload_document(file: UploadFile = File(...)):
    """上传并向量化知识库文档"""
    try:
        # 保存文件
        file_path = os.path.join("./chroma/knowledge", file.filename)
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # 开始向量化
        success = rag_llm.vectorize_file(file.filename)
        if success:
            return {"message": "文档上传并向量化成功", "filename": file.filename}
        else:
            return JSONResponse(
                status_code=500,
                content={
                    "error": "文档向量化失败",
                    "details": rag_llm.vectorization_progress.error_message,
                },
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/vectorization-progress")
async def get_vectorization_progress():
    """获取向量化进度"""
    return rag_llm.get_vectorization_progress()


@app.get("/api/knowledge-bases")
async def get_knowledge_bases():
    """获取所有知识库"""
    try:
        knowledge_dir = "./chroma/knowledge"
        if not os.path.exists(knowledge_dir):
            os.makedirs(knowledge_dir)
        files = os.listdir(knowledge_dir)
        return [
            {"name": file, "value": file, "vectorized": True}
            for file in files
            if os.path.isfile(os.path.join(knowledge_dir, file))
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/voices")
async def get_voices():
    return VOICE_OPTIONS


@app.post("/chat")
async def chat(query: str, knowledge: str = ""):
    """处理聊天请求"""
    logger.info(f"收到问题: {query}")
    if knowledge:
        logger.info(f"使用知识库: {knowledge}")

    master = Master()
    try:
        res = master.qingxu_chain(query, knowledge)
        response = next(res)  # 获取生成器的第一个值
        logger.info(f"生成回答: {response}")
        return [response]  # 返回列表以保持与前端兼容
    except Exception as e:
        logger.error(f"生成回答失败: {str(e)}")
        return [{"msg": "生成回答时发生错误，请稍后重试。", "qingxu": "default"}]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
