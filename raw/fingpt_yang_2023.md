[liteparse] extract: 56.1ms (9 pages)
[liteparse] ocr render: 5.2ms (0 pages)
[liteparse] ocr: 0.0ms
[liteparse] project: 4.6ms
[liteparse] total: 66.6ms
arXiv:2306.06031v2 [q-fin.ST] 15 Nov 2025










                        FinGPT: Open-Source Financial Large Language Models

                       Hongyang Yang1, Xiao-Yang Liu2, Christina Dan Wang3∗
                                      1AI4Finance Foundation†     ;
        2Columbia     University;
        3New     York University Shanghai
        contact@ai4finance.org

                           Abstract                               domains. This sweeping change has engendered keen interest
          Large language models (LLMs) have shown the             in the potential applications of financial LLMs (FinLLMs). It
      potential of revolutionizing natural language pro-          is, however, evident that the acquisition of high-quality, rel-
      cessing in diverse domains, sparking great interest         evant, and up-to-date data stands as a critical factor in the
       in finance. However, the finance domain presents           development of efficacious and efficient FinLLMs.
        unique challenges, including high temporal sen-                 Utilizing LLMs in the finance sector reveals intricate hur-
        sitivity, constant dynamism, and a low signal-            dles. Firstly, there's the issue of high temporal sensitivity.
        to-noise ratio (SNR). While proprietary models            Financial data are characterized by their time-sensitive na-
        like BloombergGPT have taken advantage of their           ture. Market-moving news or updates, once released, pro-
       unique data accumulation, such privileged access           vide a narrow window of opportunity for investors to maxi-
      calls for an open-source alternative to democratize         mize their alpha (the measure of an investment's relative re-
    internet-scale financial data.                                turn). Secondly, the financial landscape is marked by high
        In this paper, we present an open-source large            dynamism. It is in a constant state of flux due to the ceaseless
         language model, FinGPT, for the finance sec-             flow of news, social media updates, and other market-related
                                                                  information. Given these constant changes, retraining LLMs
    tor.   Unlike proprietary models, FinGPT takes a              frequently is not only expensive but also impractical. Lastly,
       data-centric approach, providing researchers and           financial data is often characterized by a low signal-to-noise
       practitioners with accessible and transparent re-          ratio (SNR) [Yang et al., 2020]. The useful information is
        sources to customize their financial LLMs (Fin-           often hidden amongst a significant amount of irrelevant or
         LLMs). We highlight the importance of an au-             noisy data. Extracting valuable insights from this sea of in-
      tomatic data curation pipeline and the lightweight          formation necessitates advanced techniques.
        low-rank adaptation technique in building Fin-                      In the proprietary sphere, models like BloombergGPT [Wu
        GPT. Furthermore, we provide fundamental tasks            et al., 2023] have capitalized on their exclusive access to spe-
         as building blocks for benchmarking and show-            cialized data to train a FinLLM. However, the restricted ac-
      case potential applications as stepping stones for          cessibility and transparency of their data collections and train-
       users, such as robo-advising and sentiment anal-           ing protocols have accentuated the demand for an open and
    ysis.  Through collaborative efforts within the               inclusive alternative. In response to this demand, we are wit-
         open-source AI4Finance community, FinGPT aims            nessing a shifting trend towards democratizing internet-scale
         to stimulate innovation, democratize FinLLMs,            financial data in the open finance domain.
         and unlock new opportunities in open finance.
         Two associated code repos are https://github.                    In this paper, we address these aforementioned challenges
         com/AI4Finance-Foundation/FinGPT and https://            associated with financial data and introduce FinGPT, an end-
    github.com/AI4Finance-Foundation/FinNLP                       to-end open-source framework for financial large language
                                                                  models (FinLLMs). Adopting a data-centric approach, Fin-
                                                                  GPT underscores the crucial role of data acquisition, clean-
    1 Introduction                                                ing, and preprocessing in developing open-source FinLLMs.
  The continual expansion and evolution of artificial intel-      By championing data accessibility, FinGPT aspires to en-
   ligence have provided a fertile ground for the prolifera-      hance research, collaboration, and innovation in finance,
   tion of LLMs [Vaswani et al., 2017; Radford et al., 2018;      paving the way for open finance practices.
  Devlin et al., 2018; Ethayarajh, 2019; Lewis et al., 2019;      Our contributions are summarized as follows:
   Lewis et al., 2020; Brown et al., 2020; Thoppilan et al.,      • Data-centric approach: Recognizing the significance of
2022], thereby effecting a transformative shift across diverse             data curation, FinGPT adopts a data-centric approach and
    ∗Corresponding author.                                                   implements rigorous cleaning and preprocessing methods
    †AI4Finance Foundation: ai4finance.org                        for handling varied data formats and types.

International Symposium on Large Language Models for Financial Services (FinLLM 2023)@IJCAI 2023 -
                                 https://finllm.github.io/workshop

• End-to-end framework: FinGPT embraces a full-stack                Our FinGPT responds to the aforementioned hurdles, pre-
framework with five layers:                                                        senting an open-source FinLLM. It employs Reinforcement
               - Data source layer: Assures comprehensive market                     Learning from Human Feedback (RLHF) to understand and
         coverage, addressing the temporal sensitivity of finan-               adapt to individual preferences, paving the way for person-
     cial data through real-time information capture.                         alized financial assistants. We aim to combine the strengths
                                                                               of general LLMs like ChatGPT with financial adaptation, ex-
              - Data engineering layer: Primed for real-time NLP    ploiting LLM's capability in open finance.
          data processing, this layer tackles the inherent chal-
          lenges of high temporal sensitivity and low signal-to-    2.2  Why Open-Source FinLLMs?
     noise ratio in financial data.                                 AI4Finance Foundation1 is a non-profit, open-source organi-
                - LLMs layer: Focusing on a range of fine-tuning         zation that integrates Artificial Intelligence (AI) and financial
          methodologies, this layer takes care of the highly dy-              applications. With a proven track record of nurturing an in-
            namic nature of financial data, ensuring the model's                  novative ecosystem of FinTech tools, such as FinRL [Yang
     relevance and accuracy.                                                   et al., 2020] and FinRobot [Yang et al., 2024], the founda-
            - Tasks Layer: This layer is responsible for execut-             tion is poised to accelerate the evolution of FinLLMs. Stead-
     ing fundamental tasks.     These tasks serve as the                       fast commitment and cutting-edge contributions may pave the
               benchmarks for performance evaluations and cross-    way for AI's transformative applications in open finance.
     comparisons in the realm of FinLLMs.                                           • Advancing equal opportunities via democratizing Fin-
         - Applications layer: Showcasing practical applications                        LLMs: Adopting an open-source methodology promotes
         and demos, this layer highlights the potential capabil-              universal access to state-of-the-art technology, adhering to
     ity of FinGPT in the finance sector.                           the ethos of democratizing FinLLMs.
         • Democratization: FinGPT, as an open-source framework,                 • Cultivating transparency and trust: Open-source FinLLMs
        aims to democratize financial data and FinLLMs, uncover-                offer a comprehensive overview of their foundational code-
       ing untapped potentials in open finance. We envision Fin-    base, bolstering transparency and trust.
     GPT as a catalyst for stimulating innovation within the fi-                   • Accelerating research and innovation: The open-source
        nance domain. FinGPT is not limited to providing techni-
   cal contributions, but also cultivates an open-source ecosys-                   model fuels progress in research and development within
        tem for FinLLMs, promoting real-time processing and cus-                 the AI domain. It allows researchers to leverage existing
        tomized adaptation for users. By nurturing a robust col-                 models, thus nurturing a faster progression of innovation
          laboration ecosystem within the open-source AI4Finance    and scientific discovery.
       community, FinGPT is positioned to refine our understand-    • Enhancing education:   Open-source FinLLMs serve as
ing and application of FinLLMs.                                                     robust educational tools, presenting students with the
                                                                                 prospect of exploring the complexities of FinLLMs through
2 Related Work                                                      direct engagement with fully operational models.
2.1  The Raise of FinLLMs                                                   • Upgrade foundation infrastructure for financial text data by
                                                                                 community collaboration: This collaborative participation
          Large Language Models (LLMs) have been recognized as a              bolsters the model's long-term durability and effectiveness.
       technological breakthrough in NLP, such as GPT-3 and GPT-
        4 [Brown et al., 2020; Jiang et al., 2023; OpenAI, 2023;    3 Overview of FinGPT: An Open-Source
    Team et al., 2023; Liu et al., 2024]. They take transformer-
       based architectures, demonstrating impressive performance    Framework for FinLLMs
     across various text-generation tasks. As an offshoot of the                 FinGPT represents an innovative open-source framework de-
            GPT family developed by OpenAI, ChatGPT was designed                 signed specifically for FinLLMs. As delineated in Fig. 1,
      to produce human-like texts based on input prompts. It has                 FinGPT consists of four components: Data Source, Data En-
  shown significant utility in diverse applications, from draft-              gineering, LLMs, and Applications. Each plays a crucial role
ing emails to writing code and even in creating art content.                  in maintaining the functionality and adaptability of FinGPT.
       LLMs have been applied to various tasks within the finan-                • Data source layer: The starting point is the Data Source
cial sector [Dredze et al., 2016; Araci, 2019; Bao et al., 2021;                Layer, which orchestrates the acquisition of extensive fi-
   DeLucia et al., 2022], from predictive modeling to generating              nancial data from a wide array of online sources. This layer
insightful narratives from raw financial data. Recent literature                 ensures comprehensive market coverage by integrating data
  has focused on using these models for financial text analysis,              from news websites, social media platforms, financial state-
    given the abundance of text data in this field, such as news                ments, market trends, and more. The goal is to capture the
articles, earnings call transcripts, and social media posts.
             The first example of FinLLMs is BloombergGPT [Wu et    1https://ai4finance.org. The AI4Finance Foundation is a U.S.-
   al., 2023], which was trained on a mixed dataset of financial        registered 501(c)(3) nonprofit public charity focused on promoting
  and general data sources. Despite its impressive capabilities,    open scientific research in financial AI, building open-source infras-
 access limitations exist, and the prohibitive training cost has        tructure, and supporting a global community of researchers through
motivated the need for low-cost domain adaptation.                  shared datasets, benchmarks, and educational programs.

         2

                                                                     FinGPT

  A               Robo-  Financial Sentiment  Portfolio   Risk                                    Quantitative    Low-Code
  W              advisor      Analysis      Optimization                                 Management  Trading     Development
  S  Applications  ESG     Financial Fraud     Credit   Financial                                      M&A          Other
                 Scoring      Detection        Scoring  Education                                  Forecasting  Applications

                       Summarization                     Named-entity
  G      Tasks                                           Recognition (NER)       Information Extraction              Sentiment Analysis
  C                    Data Analysis              Numerical Reasoning                  Terminology
  P                                                                                   Understanding                   Intent Detection
                       Prompt Construction               LLM APIs        Trainable Models        Fine-tuning Methods
                   Retrieval-      ChatGPT                           Claude    Llama3    Mistral        Low-
Cloud               Augmented                                                                  rank Adaptation (LoRA),
         LLMs    Generation(RAG)    LLaMA                             Grok    DeepSeek    Qwen3         QLoRA
                Chain-of-Thought                                                              Reinforcement Learning on Other
  A                                 Kimi                             Gemini    Falcon     Gemma  Stock Prices (RLSP) Systems
  Z
  U
  R      Data         Data Cleaning           Tokenization               Vector Embedding Feature Extraction           Data Augmentation
  E   Engineering

                       Cloud Native                                  On-Premises    Graphics Processing Unit Server    Vector Database
  I                                                                                                                       (Storage)
  B                    News Finnhub Yahoo                CNBC        .......
  M                                           Finance                                                                      FinNLP
         Data Source   Media Twitter          Weibo      Reddit      .......
                       Filings SEC                    NYSE NASDAQ    .......              Data Integration         Real-time data pipeline
 ...                                                                                                                        APIs
 ...                   Trends Google Trends Seeking Alpha            .......                                           Streaming Data
                       Datasets AShare        stocknet-              ......
                                              dataset


                           Figure 1: Overall framework of FinGPT.

  nuance of the market, thereby addressing the inherent tem-            demos not only serve as a guide to potential users but also
  poral sensitivity.                                                    underscore the transformative potential of FinLLMs.
          • Data engineering layer: This layer focuses on the real-     3.1  Data Sources
  time processing of text data to tackle the challenges of high
  temporal sensitivity and low signal-to-noise ratio inherent           The first stage of FinGPT involves the collection of extensive
  in financial data. It incorporates state-of-the-art NLP tech-              financial data from a wide array of online sources. These
  niques to filter noise and highlight the most salient pieces          include, but are not limited to:
  of information.                                                              • Financial news: Websites such as Reuters, CNBC, Yahoo
           • LLMs layer: Lying at the heart, it encompasses various     Finance, among others, are rich sources of financial news
  fine-tuning methodologies, prioritizing lightweight adapta-           and market updates. These sites provide valuable informa-
  tion, to keep the model updated and pertinent. By maintain-           tion on market trends, company earnings, macroeconomic
  ing an updated model, FinGPT can take care of the highly              indicators, and other financial events.
  dynamic nature of financial data, ensuring its responses are               • Social media: Platforms such as Twitter, Facebook, Red-
  in sync with the current financial climate.                           dit, Weibo, and others, offer a wealth of information in
       • Tasks layer: The tasks layer is designed to provide build-     terms of public sentiment, trending topics, and immediate
  ing blocks. This layer serves a dual purpose: first, it exe-          reactions to financial news and events.
  cutes a variety of fundamental tasks that are crucial in the           • Filings: Websites of financial regulatory authorities, such
  FinLLMs landscape, such as sentiment analysis, content                as the SEC in the United States, offer access to company
  summarization, and numerical reasoning. Second, it estab-             filings. These filings include annual reports, quarterly earn-
  lishes a standardized set of metrics and attributes. These            ings, insider trading reports, and other important company-
  standardized elements act not only as indicators but also as          specific information. Official websites of stock exchanges
  benchmarks, facilitating both performance evaluation and              (NYSE, NASDAQ, Shanghai Stock Exchange, etc.) pro-
  comparative analysis in the domain of FinLLMs.                        vide crucial data on stock prices, trading volumes, company
              • Application layer: The final component of FinGPT is     listings, historical data, and other related information.
  the Applications Layer, designed to demonstrate the prac-                  • Trends: Websites like Seeking Alpha, Google Trends, and
  tical applicability of FinGPT. It offers hands-on tutorials           other finance blogs and forums provide access to analysts'
  and demo applications for financial tasks, including robo-            opinions, market predictions, the movement of specific se-
  advisory services and sentiment analysis. These practical             curities or market segments and investment advice.

                                                                       3

• Academic datasets: Research-based datasets that offer cu-                layer includes:
rated and verified information for financial analysis.                     • LLM APIs: Established LLM APIs offer foundational lan-
               To harness the wealth of information from these diverse            guage capabilities that serve as the base for further model
sources, FinGPT incorporates data acquisition tools capable                development and customization.
of scraping structured and unstructured data, including APIs,              • Trainable models: Users can fine-tune FinGPT's trainable
web scraping tools, and direct database access where avail-                        models on private data for personalized financial applica-
able. Moreover, the system is designed to respect the terms                     tions, ensuring relevance and accuracy in specific use cases.
of service of these platforms, ensuring data collection is ethi-
cal and legal.                                                             • Fine-tuning methods:  FinGPT supports various fine-
                 Data APIs: In the FinGPT framework, APIs are used not            tuning methodologies, facilitating its adaptation into per-
only for initial data collection but also for real-time data up-           sonalized robo-advisors efficiently and effectively.
dates, ensuring the model is trained on the most current data.             • Prompt Engineering: Prompt Engineering is crucial for
Additionally, error handling and rate-limiting strategies are                      optimizing input queries to LLMs, enhancing the extraction
implemented to respect API usage limits and avoid disrup-                       of accurate financial information. This iterative process re-
tions in the data flow.                                                             quires careful crafting of prompts for nuanced responses,
                                                                                  necessitating a deep understanding of both finance and lan-
3.2     Real-Time Data Curation Pipeline for                               guage model characteristics.
        Financial NLP                                                      Why lightweight fine-tuning LLMs for finance?
Financial markets operate in real-time and are highly sensi-                       Fine-tuning or Instruction tuning of pre-existing LLMs for
tive to news and sentiment. Prices of securities can change                finance, as described in [Ouyang et al., 2022], presents a
rapidly in response to new information, and delays in pro-                 cost-efficient and time-saving alternative to the expensive and
cessing that information can result in missed opportunities or             lengthy process of retraining models from scratch.
increased risk. As a result, real-time processing is essential in                    BloombergGPT [Wu et al., 2023], though remarkable in its
financial NLP.                                                             finance-specific capabilities, comes with an intensive com-
                The primary challenge with a real-time NLP pipeline is     putational requirement. It used approximately 1.3 million
managing and processing the continuous inflow of data ef-                  GPU hours for training, which, when calculated using AWS
ficiently. The first step in the pipeline is to set up a system to         cloud's $2.3 rate, translates to a staggering cost of around $3
ingest data in real-time. This data could be streaming from                million per training. In contrast to the high computational
our data source APIs. Below are the steps to design a real-                cost of models like BloombergGPT [Wu et al., 2023], Fin-
time NLP pipeline for data ingestion.                                      GPT presents a more accessible solution by focusing on the
              Data cleaning: Real-time data can be noisy and inconsis-     lightweight adaptation of top open-source LLMs. The cost
tent.             Therefore, real-time data cleaning involves removing     of adaptation falls significantly, estimated at around $300 per
irrelevant data, handling missing values, text normalization               fine-tuning.
(like lowercasing), and error corrections.                                         This approach ensures timely updates and adaptability, es-
             Tokenization: In real-time applications, tokenization has     sential in the dynamic financial domain. Being open-source,
to be performed on the fly. This involves breaking down the                FinGPT not only promotes transparency but also allows
stream of text into smaller units or tokens.                               user customization, catering to the rising trend of personal-
               Vector embedding: FinGPT encodes curated financial text     ized financial advisory services. Ultimately, FinGPT's cost-
into dense semantic vectors using domain-adapted embed-                    effective, flexible framework holds the potential to democra-
ding models. The embedding process incorporates entity-                    tize financial language modeling and foster user-focused fi-
aware representations (tickers, ratios, events) and temporal               nancial services.
metadata, allowing the system to capture fine-grained fi-
nancial meaning. All embeddings are indexed in a vector                    Fine-tuning via Low-rank Adaptation (LoRA)
database for low-latency retrieval, supporting RAG, event                  In FinGPT, we fine-tune a pre-trained LLM utilizing a finan-
clustering, and market-aligned RLSP training.                              cial dataset. It's well recognized that high-quality labeled
                Feature extraction: Feature extraction involves trans-     data is a pivotal determinant for many successful LLMs, in-
forming raw data into an input that can be understood by ML                cluding ChatGPT. However, acquiring such top-notch labeled
models. In real-time systems, this often needs to be a fast and            data often proves costly in terms of time and resources and
efficient process. Techniques such as TF-IDF, Bag of Words,                generally requires the expertise of finance professionals.
or embedding vectors like Word2Vec can be used.                                            When the application of LLMs is envisioned for the
              Data augmentation: In the dynamic landscape of financial     scrutiny of financial texts and facilitation of quantitative trad-
markets, enhancing the variety and volume of training data is              ing strategies, it is imperative to contemplate the utilization
crucial for building robust NLP models. Data augmentation                  of the intrinsic labeling mechanisms available within the fi-
strategies will be employed to generate synthetic data that can            nancial marketplace. In light of this, FinGPT adopts the per-
mimic the characteristics of actual financial data.                        centage of relative stock price changes corresponding to in-
                                                                           dividual news articles as output labels. By assigning prede-
3.3    Large Language Models (LLMs)                                        termined thresholds, these continuous labels are categorized
Once the data has been properly prepared, it is used with                  into three discrete sentiment classes: positive, negative, and
LLMs to generate insightful financial analyses. The LLM                    neutral.

            4

Simultaneously, during the prompt engineering phase, the                  • Summarization: FinGPT can efficiently condense lengthy
model is meticulously instructed to elect one among the three           financial documents into concise summaries, preserving the
sentiment classes as its output. This meticulous approach en-           crucial information and insights. This function is invalu-
sures that the information gleaned during pre-training is max-            able for quickly understanding the essence of comprehen-
imally exploited, fostering the generation of insightful and re-      sive reports, news articles, or financial statements without
liable predictions on financial sentiment. The implementation       going through the entire content.
of Low-Rank Adaptation (LoRA) for LLMs [Hu et al., 2021;                   • Named-entity recognition (NER): The model is adept at
Dettmers et al., 2023], along with its quantized variant,              identifying and classifying named entities within the text,
QLoRA [Dettmers et al., 2023], significantly streamlines the                such as company names, stock tickers, monetary values,
model by reducing the count of trainable parameters from an           and percentages. This ability is crucial for extracting spe-
overwhelming 6.17 billion to a manageable 3.67 million.                cific data points from unstructured text, facilitating more
Fine-tuning via Reinforcement Learning on Stock Prices              structured and informed analysis.
(RLSP)                                                                       • Information extraction: FinGPT can meticulously ex-
Similarly, we can substitute Reinforcement Learning on                  tract relevant information from various sources, providing
Stock Prices (RLSP) for Reinforcement Learning on Human               users with valuable insights. This capability is crucial for
feedback, as utilized by ChatGPT. The reasoning behind this            decision-making processes, as it sifts through the noise to
substitution is that stock prices offer a quantifiable, objective   highlight essential data and trends.
metric that reflects market sentiment in response to news and        • Sentiment analysis: Sentiment Analysis is pivotal as a fun-
events. This makes it a robust, real-time feedback mechanism           damental task due to its dual application in both identify-
for training our model.                                                  ing market sentiment, namely financial sentiment analysis
Reinforcement Learning (RL) allows the model to learn                    and being utilized within robo-advisory platforms to dis-
through interaction with the environment and receiving feed-        cern client emotions during product recommendations.
back.  In the case of RLSP, the environment is the stock            • Data analysis: FinGPT can process and analyze vast
market, and the feedback comes in the form of stock price               datasets, identifying patterns, anomalies, and significant
changes. This approach permits FinGPT to refine its under-          changes in the data.  This feature supports data-driven
standing and interpretation of financial texts, improving its            decision-making, offering a clearer understanding of mar-
ability to predict market responses to various financial events.    ket dynamics and financial performance.
By associating news sentiment with the subsequent perfor-
mance of the related stocks, RLSP provides an effective way                  • Numerical reasoning: The model can perform calcula-
to fine-tune FinGPT. In essence, RLSP allows the model to               tions and numerical analysis based on the data provided in
infer the market's response to different news events and ad-           the text, supporting users in evaluating financial metrics,
just its understanding and predictions accordingly.                 making projections, and assessing risks effectively.
Therefore, the integration of RLSP into the fine-tuning pro-              • Terminology understanding: FinGPT is proficient in un-
cess of FinGPT provides a powerful tool for improving the               derstanding and interpreting complex financial terminology
model's financial market understanding and predictive accu-           and jargon, making it a valuable assistant for both seasoned
racy. By using actual stock price movements as feedback, we         professionals and individuals new to the financial sector.
are directly harnessing the wisdom of the market to make our             • Intent detection: The model can accurately identify the
model more effective.                                                user's intent behind a query, facilitating more effective and
Retrieval Augmented Generation (RAG)                                relevant responses. This feature is particularly useful in de-
Retrieval-augmented generation (RAG) is a pivotal technique            veloping intuitive and user-friendly financial advisory ap-
incorporated within FinGPT [Zhang et al., 2023], as it seam-        plications and services.
lessly amalgamates the prowess of both context retrieval                  Various open-source datasets serve as benchmarks, effec-
mechanisms and Large Language Models (LLMs) to opti-                                                                           Ex-  tively engaging in a multitude of fundamental tasks.
mize language generation tasks. This meticulous process en-               amples include BloombergGPT[Wu et al., 2023], which uti-
sures that the LLMs are not generating content in a vacuum            lizes a curated selection of financial datasets derived from
but are rather informed and nuanced in their output, draw-               the FLUE benchmark[Shah et al., 2022]. These datasets are
ing from a rich tapestry of context provided by the retrieved            employed for a spectrum of essential tasks such as Senti-
documents. These documents, working in tandem with the                    ment Analysis and NER. Other noteworthy datasets include
input prompt, steer the LLMs effectively towards crafting re-           FinRED [Sharma et al., 2022], instrumental for information
sponses that are not only accurate but deeply ingrained in the           extraction tasks, FINQA [Chen et al., 2021] for numerical
relevant context, thereby increasing the utility and reliability           reasoning assessments, and FinRAD [Ghosh et al., 2021],
of the generated text.                                                which is crucial for understanding and identifying financial
3.4    Fundamental Tasks                                            terms.
FinGPT serves as a versatile tool in the financial sector, pro-     3.5  Potential Applications
viding valuable assistance to both professionals and individ-        FinGPT may find wide applications in financial services, aid-
uals by effectively filtering and analyzing information. The           ing professionals and individuals as a powerful information
model excels in the following fundamental tasks:                    filter. The potential applications include:

    5

• Financial sentiment analysis:      Evaluating sentiments           4.1  Financial News
     across different financial platforms for insightful invest-     Financial news carries vital information about the world
ment guidance.                                                       economy, specific industries, and individual companies. This
           • Robo-advisor: The Robo-advisor function within Fin-     data source typically features:
      LLMs plays a pivotal role in providing personalized finan-     • Timeliness: Financial news reports are timely and up-to-
       cial advice, minimizing the necessity for continual human            date, often capturing the most recent developments in the
consultations.                                                       financial world.
       • Quantitative trading: Producing trading signals for in-
formed trading decisions.                                            • Dynamism: The information contained in financial news
       • Portfolio optimization: Utilizing numerous economic in-            is dynamic, changing rapidly in response to evolving eco-
     dicators and investor profiles for optimal investment port-     nomic conditions and market sentiment.
folio construction.                                                  • Influence: Financial news has a significant impact on fi-
    • Credit scoring: Predicting creditworthiness from financial           nancial markets, influencing traders' decisions and poten-
data to aid lending decisions.                                       tially leading to dramatic market movements.
          • Mergers and acquisitions (M&A) forecasting: Predict-     4.2  Company Filings and Announcements
        ing potential M&A activities by analyzing financial data     Company filings and announcements are official documents
       and company profiles, helping investors anticipate market     that corporations submit to regulatory bodies, providing in-
movements.                                                           sight into a company's financial health and strategic direction.
              • ESG (Environmental, Social, Governance) scoring:     They feature:
        Evaluating companies' ESG scores by analyzing public re-
ports and news articles.                                             • Granularity: These documents offer granular information
        • Risk management: Formulating effective risk strategies        about a company's financial status, including assets, liabil-
by analyzing various risk factors.                                   ities, revenue, and profitability.
    • Fraud detection: Identifying potential fraudulent transac-     • Reliability: Company fillings contain reliable and verified
tion patterns for enhanced financial security.                       data vetted by regulatory bodies.
               • Automating KYC Processes: FinGPT can streamline     • Periodicity: Company fillings are periodic, usually sub-
         KYC procedures by analyzing documents for identity val-        mitted on a quarterly or annual basis, offering regular snap-
      idation, cross-checking information against databases, and     shots of a company's financial situation.
    detecting inconsistencies. It can also interpret complex le-     • Impactfulness: Company announcements often have sub-
gal documents using its NLP capabilities.                                stantial impacts on the market, influencing stock prices and
               • Enhancing Anti-Money Laundering (AML) Measures:     investor sentiment.
          FinGPT can be a valuable tool in ML operations. It can
       be used to analyze the flow of funds, identify suspicious     4.3  Social Media Discussions
   patterns, and highlight transactions that require further in-     Social media discussions related to finance will reflect pub-
vestigation.                                                         lic sentiment towards specific stocks, sectors, or the overall
          • Low-code development: Facilitating software creation     market. These discussions tend to exhibit:
     through user-friendly interfaces, reducing reliance on tra-     • Variability: Social media discussions vary widely in tone,
ditional programming.                                                         content, and quality, making them rich, albeit complex,
       • Financial education: Serving as an AI tutor simplifying     sources of information.
complex financial concepts for better financial literacy.            • Real-time sentiment: These platforms often capture real-
        By linking these distinct yet interconnected components,          time market sentiment, enabling the detection of trends and
   FinGPT provides a holistic and accessible solution for lever-     shifts in public opinion.
     aging AI in finance, facilitating research, innovation, and     • Volatility: Sentiments expressed on social media can be
practical applications in the financial industry.                        highly volatile, changing rapidly in response to news events
4 Data-Centric Approach for FinLLMs                                  or market movements.
       For financial large language models (FinLLMs), a success-     4.4  Trends
 ful strategy is not solely based on the capability of the model     Trends often observable through websites like Seeking Al-
   architecture but is equally reliant on the training data. Our     pha, Google Trends, and other finance-oriented blogs and fo-
    data-centric approach prioritizes collecting, preparing, and     rums, offer critical insights into market movements and in-
processing financial data.                                           vestment strategies. They feature:
     Financial data comes from a variety of sources, with unique
characteristics. We delve into the specifics of different finan-     • Analyst perspectives: These platforms provide access to
 cial data sources, such as financial news, company fillings and               market predictions and investment advice from seasoned
announcements, social media Discussions, and trends.                 financial analysts and experts.

    6

    • Market sentiment: The discourse on these platforms can               Reinforcement Learning on Stock Prices (RLSP)
           reflect the collective sentiment about specific securities,     To align the model with real market behavior, we further ap-
           sectors, or the overall market, providing valuable insights     ply RLSP, where the environment is the financial market and
    into the prevailing market mood.                                       the reward is the stock price's post-news reaction.
    • Broad coverage: Trends data spans diverse securities and
              market segments, offering comprehensive market coverage.          R = f(∆p)
          Each of these data sources provides unique insights into the        This aligns the sentiment output with actual financial out-
    financial world. By integrating these diverse data types, Fin-         comes and enhances generalization.
    GPT can facilitate a comprehensive understanding of finan-             5.3   Baselines
    cial markets and enable effective financial decision-making.
                                                                           We compare FinGPT against standard financial NLP base-
    5 Experiments: Financial Sentiment Analysis                            lines:
    In this section, we evaluate the sentiment analysis capability         • FinBERT [Araci, 2019];
    of FinGPT. This experiment demonstrates the effectiveness              • BloombergGPT [Wu et al., 2023];
    of FinGPT's data-centric design and lightweight adaptation             • ChatGPT (zero-shot) [OpenAI, 2023];
    methodology in real-world financial text classification.               • Llama3.1-8B (zero-shot) [Grattafiori et al., 2024].
    5.1  Dataset
    We utilize a large-scale financial news sentiment dataset cu-          5.4   Evaluation Metrics
    rated through the FinGPT real-time data pipeline. The dataset          We evaluate performance using the following metrics:
    contains:                                                              • Accuracy;
    • Over 620,000 cleaned financial news headlines;                       • Precision, Recall, and F1-score for each class;
                • Sources including CNBC, Reuters, Yahoo Finance, Mar-     • Macro-F1 (to mitigate class imbalance);
ketWatch, etc., collected through the FinNLP pipeline;
    • Time span from 2016-2024;                                            • AUC for binary (positive/negative) subsets.
               • Market-driven labels generated using short-term price     5.5   Results
        movement:                                                          Overall Performance
                                                                           FinGPT outperforms all baselines significantly, demonstrat-
                         Positive,             r > θp                     ing the benefits of data-centric labeling and RLSP reinforce-
                                               r < -θn                    ment alignment.
        label =              Negative,
                         Neutral,              |r| ≤ θ                    Ablation Study
              where r denotes the stock's percentage price change fol-     LoRA performs most of the heavy lifting, while RLSP further
    lowing the news. This "self-labeled" approach aligns sen-              improves market alignment.
    timent with true market reactions and avoids costly manual             Case Study
    annotation.                                                            We illustrate the model's financial reasoning capability using
    5.2  Model and Training Setup                                          the following headline:
    We adopt a lightweight two-stage adaptation process.    "Tesla cuts prices again in China as EV competi-
    LoRA-based Supervised Fine-Tuning                                          tion intensifies."
    We fine-tune the pretrained Llama-3.1-8B-Instruct                                  • Human Annotation: Negative (Price reductions are
    model using Low-Rank Adaptation (LoRA). Under a stan-                               commonly interpreted as a sign of weakening pric-
    dard configuration of rank r = 8 and scaling factor α = 16,                   ing power and intensified competitive pressure, both of
    the total number of trainable parameters introduced by LoRA                    which imply potential margin compression and typically
    is approximately 8.3M, which is well below 0.1% of the orig-               induce negative investor sentiment.)
    inal 8B-parameter model.                                                      • Base Llama3: Neutral (The model captures the surface-
    The fine-tuning configuration is as follows:                                level wording but fails to infer the underlying financial
    • Trainable parameters: 8.3M;                                              implications of price competition.)
    • LoRA rank: r = 8, scaling factor α = 16;                             • FinGPT (SFT): Negative
    • Batch size: 64;                                                               • FinGPT (RLSP): Negative (with stronger alignment to
    • Learning rate: 2 × 10-4   ;                                              the subsequent price reaction)
    • Training epochs: 3.                                                            This case highlights FinGPT's ability to incorporate
                                                                           domain-specific financial reasoning and to produce sentiment
                 LoRA enables FinGPT to acquire domain-specific senti-     predictions that are more consistent with market-impactful in-
    ment classification ability efficiently.                               terpretations.

                                                    7

        Table 1: Sentiment Classification Performance

    Model                  Acc.  Macro-F1  Pos-F1  Neg-F1  Neu-F1
    ChatGPT (0-shot)       63.4    61.7     64.0    59.1    62.0
    Llama3.1-8B (0-shot)   57.9    54.4     56.1    53.2    54.0
    FinBERT                71.2    69.9     73.0    69.1    67.5
    FinGPT (LoRA-SFT)      78.8    77.3     79.6    76.8    75.4
    FinGPT (SFT+RLSP)      82.1    80.9     83.4    81.5    77.8


        Table 2: Ablation on LoRA and RLSP                                   and evaluation. By integrating open-source tooling, repro-
                                                                                 ducible benchmarks, and transparent workflows, FinLLMs
         Configuration    Macro-F1                                         aims to provide a foundation for reliable, scalable, and in-
         Base Llama3        54.4                                           teroperable financial AI systems.
         + LoRA SFT         77.3                                            Disclaimer: We are sharing codes for academic pur-
         + RLSP             80.9                                               poses under the MIT education license. Nothing herein is
                                                                               financial advice, and NOT a recommendation to trade real
                                                                                money. Please use common sense and always first consult
    5.6  Discussion                                                        a professional before trading or investing.
    Key observations:
                • Market-driven labels (self-labeled data) strongly im-    References
        prove real-world applicability;                                                                             Financial sentiment  [Araci, 2019] Dogu Araci.  Finbert:
                   • LoRA reduces adaptation cost by ∼1000× compared to     analysis with pre-trained language models. arXiv preprint
        full fine-tuning;                                                   arXiv:1908.10063, 2019.
                 • RLSP incorporates financial market feedback, distin-        [Bao et al., 2021] Siqi Bao, Huang He, Fan Wang, Hua Wu,
guishing FinGPT from traditional supervised models.                         Haifeng Wang, Wenquan Wu, Zhihua Wu, Zhen Guo, Hua
                                                                            Lu, Xinxian Huang, et al. Plato-xl: Exploring the large-
               This experiment confirms that FinGPT provides a scalable     scale pre-training of dialogue generation. arXiv preprint
    and effective foundation for financial sentiment analysis.              arXiv:2109.09519, 2021.
                                                                                [Brown et al., 2020] Tom Brown, Benjamin Mann, Nick Ry-
    6 Conclusion                                                            der, Melanie Subbiah, Jared D Kaplan, Prafulla Dhari-
    In conclusion, the transformative integration of large lan-             wal, Arvind Neelakantan, Pranav Shyam, Girish Sastry,
    guage models (LLMs) into the financial sector brings unique             Amanda Askell, et al.          Language models are few-shot
    complexities and vast opportunities. Navigating challenges              learners. Advances in Neural Information Processing Sys-
    such as high temporal sensitivity, dynamic financial land-              tems, 33:1877-1901, 2020.
    scape, and a low signal-to-noise ratio in financial data calls             [Chen et al., 2021] Zhiyu Chen, Wenhu Chen, Charese Smi-
    for efficient solutions.  FinGPT responds innovatively by               ley, Sameena Shah, Iana Borova, Dylan Langdon, Reema
    leveraging pre-existing LLMs and fine-tuning them to spe-               Moussa, Matt Beane, Ting-Hao Huang, Bryan Routledge,
    cific financial applications. This approach significantly re-           et al. Finqa: A dataset of numerical reasoning over finan-
    duces adaptation costs and computational requirements com-              cial data. arXiv preprint arXiv:2109.00122, 2021.
    pared to models like BloombergGPT, offering a more acces-
    sible, flexible, and cost-effective solution for financial lan-                                                                 Wu,  [DeLucia et al., 2022] Alexandra  DeLucia,  Shijie
    guage modeling. Thus, it enables consistent updates to en-              Aaron Mueller, Carlos Aguirre, Philip Resnik, and Mark
    sure model accuracy and relevance, a critical aspect in the             Dredze. Bernice: a multilingual pre-trained encoder for
    dynamic and time-sensitive world of finance.                            Twitter.         In Proceedings of the Conference on Empir-
                                                                            ical Methods in Natural Language Processing, pages
    7 Future Work                                                           6191-6205, 2022.
    Future development of FinLLMs will focus on establish-                      [Dettmers et al., 2023] Tim Dettmers, Artidoro Pagnoni,
    ing open, industry-level standards for financial large lan-             Ari Holtzman, and Luke Zettlemoyer.              QLoRA: Ef-
    guage models. This includes advancing parameter-efficient               ficient finetuning of quantized LLMs.        arXiv preprint
    fine-tuning methods such as LoRA and QLoRA to support                   arXiv:2305.14314, 2023.
    low-cost, domain-specific customization across diverse finan-              [Devlin et al., 2018] Jacob Devlin, Ming-Wei Chang, Ken-
    cial institutions.  Furthermore, FinLLMs will continue to               ton Lee, and Kristina Toutanova. Bert: Pre-training of
    expand its unified data curation pipeline, promoting high-              deep bidirectional transformers for language understand-
    quality, standardized financial datasets to streamline training         ing. arXiv preprint arXiv:1810.04805, 2018.

                                             8

         [Dredze et al., 2016] Mark Dredze, Prabhanjan Kambadur,     Chong Zhang, Sandhini Agarwal, Katarina Slama, Alex
Gary Kazantsev, Gideon Mann, and Miles Osborne. How                  Ray, et al. Training language models to follow instruc-
twitter is changing the nature of financial news discovery.          tions with human feedback. Advances in Neural Informa-
In Proceedings of the second International Workshop on               tion Processing Systems, 35:27730-27744, 2022.
Data Science for Macro-modeling, pages 1-5, 2016.                       [Radford et al., 2018] Alec Radford, Karthik Narasimhan,
         [Ethayarajh, 2019] Kawin Ethayarajh. How contextual are     Tim Salimans, Ilya Sutskever, et al. Improving language
contextualized word representations? comparing the ge-               understanding by generative pre-training. OpenAI, 2018.
ometry of bert, elmo, and gpt-2 embeddings.                arXiv      [Shah et al., 2022] Raj Sanjay Shah, Kunal Chawla, Dheeraj
preprint arXiv:1909.00512, 2019.                                     Eidnani, Agam Shah, Wendi Du, Sudheer Chava, Na-
        [Ghosh et al., 2021] Sohom Ghosh, Shovon Sengupta, Sudip     traj Raman, Charese Smiley, Jiaao Chen, and Diyi Yang.
Naskar, and Sunny Kumar Singh.      FinRead: A trans-                When flue meets flang: Benchmarks and large pre-trained
fer learning based tool to assess readability of defini-             language model for financial domain.         arXiv preprint
tions of financial terms. In Proceedings of the 18th In-             arXiv:2211.00083, 2022.
ternational Conference on Natural Language Processing                                                                     Nayak,  [Sharma et al., 2022] Soumya  Sharma,  Tapas
(ICON), pages 658-659, National Institute of Technology              Arusarka Bose, Ajay Kumar Meena, Koustuv Dasgupta,
Silchar, Silchar, India, December 2021. NLP Association              Niloy Ganguly, and Pawan Goyal. Finred: A dataset for
of India (NLPAI).                                                    relation extraction in financial domain.       In Companion
[Grattafiori et al., 2024] Aaron  Grattafiori,         Abhimanyu     Proceedings of the Web Conference 2022, WWW '22,
Dubey, Abhinav Jauhri, Abhinav Pandey, Abhishek                      page 595-597, New York, NY, USA, 2022. Association
Kadian, Ahmad Al-Dahle, Aiesha Letman, Akhil Mathur,                 for Computing Machinery.
Alan Schelten, Alex Vaughan, et al. The llama 3 herd of                   [Team et al., 2023] Gemini Team, Rohan Anil, Sebastian
models. arXiv preprint arXiv:2407.21783, 2024.                       Borgeaud, Jean-Baptiste Alayrac, Jiahui Yu, Radu Soricut,
     [Hu et al., 2021] Edward J Hu, Yelong Shen, Phillip Wallis,     Johan Schalkwyk, Andrew M Dai, Anja Hauth, Katie Mil-
Zeyuan Allen-Zhu, Yuanzhi Li, Shean Wang, Lu Wang,                   lican, et al. Gemini: a family of highly capable multimodal
and Weizhu Chen. LoRA: Low-rank adaptation of large                  models. arXiv preprint arXiv:2312.11805, 2023.
language models. International Conference on Learning                   [Thoppilan et al., 2022] Romal Thoppilan, Daniel De Fre-
Representations, 2021.                                               itas, Jamie Hall, Noam Shazeer, Apoorv Kulshreshtha,
                                                                     Heng-Tze Cheng, Alicia Jin, Taylor Bos, Leslie Baker,
   [Jiang et al., 2023] Albert Q. Jiang, Alexandre Sablayrolles,     Yu Du, et al. Lamda: Language models for dialog ap-
Arthur Mensch, Chris Bamford, Devendra Singh Chaplot,                plications. arXiv preprint arXiv:2201.08239, 2022.
Diego de las Casas, Florian Bressand, Gianna Lengyel,                  [Vaswani et al., 2017] Ashish Vaswani, Noam Shazeer, Niki
Guillaume Lample, Lucile Saulnier, Lelio Renard Lavaud, ´            Parmar, Jakob Uszkoreit, Llion Jones, Aidan N Gomez,
Marie-Anne Lachaux, Pierre Stock, Teven Le Scao,                     Ł ukasz Kaiser, and Illia Polosukhin. Attention is all you
Thibaut Lavril, Thomas Wang, Timothee Lacroix, and ´                 need. In Advances in Neural Information Processing Sys-
William El Sayed. Mistral 7b, 2023.                                  tems, volume 30. Curran Associates, Inc., 2017.
       [Lewis et al., 2019] Mike Lewis, Yinhan Liu, Naman Goyal,       [Wu et al., 2023] Shijie Wu, Ozan Irsoy, Steven Lu, Vadim
Marjan Ghazvininejad, Abdelrahman Mohamed, Omer                      Dabravolski, Mark Dredze, Sebastian Gehrmann, Prab-
Levy, Ves Stoyanov, and Luke Zettlemoyer. Bart: De-                  hanjan Kambadur, David Rosenberg, and Gideon Mann.
noising sequence-to-sequence pre-training for natural lan-           BloombergGPT: A large language model for finance.
guage generation, translation, and comprehension. arXiv              arXiv preprint arXiv:2303.17564, 2023.
preprint arXiv:1910.13461, 2019.
   [Lewis et al., 2020] Patrick Lewis, Myle Ott, Jingfei Du, and          [Yang et al., 2020] Hongyang Yang, Xiao-Yang Liu, Shan
                                                                     Zhong, and Anwar Walid. Deep reinforcement learning
Veselin Stoyanov. Pretrained language models for biomed-             for automated stock trading: An ensemble strategy. In Pro-
ical and clinical tasks: understanding and extending the             ceedings of the first ACM international conference on AI
state-of-the-art. In Proceedings of the 3rd Clinical Natural         in finance, pages 1-8, 2020.
Language Processing Workshop, pages 146-157, 2020.                           [Yang et al., 2024] Hongyang Yang, Boyu Zhang, Neng
        [Liu et al., 2024] Aixin Liu, Bei Feng, Bing Xue, Bingx-     Wang, Cheng Guo, Xiaoli Zhang, Likun Lin, Junlin Wang,
uan Wang, Bochao Wu, Chengda Lu, Chenggang                           Tianyu Zhou, Mao Guan, Runjia Zhang, et al.            Fin-
Zhao, Chengqi Deng, Chenyu Zhang, Chong Ruan,                        robot: An open-source ai agent platform for financial ap-
et al.   Deepseek-v3 technical report.            arXiv preprint     plications using large language models.      arXiv preprint
arXiv:2412.19437, 2024.                                              arXiv:2405.14767, 2024.
       [OpenAI, 2023] OpenAI. Chatgpt. https://chat.openai.com/,          [Zhang et al., 2023] Boyu Zhang, Hongyang Yang, Tianyu
2023. Large language model accessed via ChatGPT inter-               Zhou, Ali Babar, and Xiao-Yang Liu. Enhancing financial
face.                                                                sentiment analysis via retrieval augmented large language
        [Ouyang et al., 2022] Long Ouyang, Jeffrey Wu, Xu Jiang,     models. ACM International Conference on AI in Finance
Diogo Almeida, Carroll Wainwright, Pamela Mishkin,                   (ICAIF), 2023.

    9