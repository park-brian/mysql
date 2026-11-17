// GENERATED FILE — do not edit by hand. Run `npm run gen:errors`.
//
// M1.6 / D-14: generated from MySQL's own error source rather than
// transcribed. D-29: facts only — codes, SQLSTATEs and strict membership. The
// English message templates are not reproduced; ground rule 7 keeps this
// repository free of MySQL source, which is GPLv2 to our MIT.
//
// Source:  mysql/mysql-server@e174239c share/messages_to_clients.txt
// SHA-256: 3ddd9dbba5d4c76101af4effb91e449027c2ca1a56242e4891736280808fd762
// Entries: 2132

/** The upstream file this table was generated from, for re-verification. */
export const ERROR_TABLE_SOURCE = 'mysql/mysql-server@e174239c share/messages_to_clients.txt'

/** SHA-256 of that file. CI regenerates and diffs; a change here is a real change. */
export const ERROR_TABLE_SOURCE_SHA256 =
  '3ddd9dbba5d4c76101af4effb91e449027c2ca1a56242e4891736280808fd762'

/** Number of entries, including OBSOLETE_* symbols, which still consume codes. */
export const ERROR_TABLE_SIZE = 2132

/** The pinned source of strict warning-promotion membership. Facts only. */
export const STRICT_ERROR_SOURCE = 'mysql/mysql-server@e174239c sql/error_handler.cc'
export const STRICT_ERROR_SOURCE_SHA256 = '709fff0c6c4f005e9bb95e16c605014a11a1f63764fb897efbf5d8f1fd346fba'

/** Native codes promoted by Strict_error_handler; no eager symbol-table lookup. */
export const STRICT_ERROR_CODES: ReadonlySet<number> = new Set([1292, 1411, 1264, 3752, 1365, 1366, 1265, 3751, 1406, 1048, 1364, 1071, 1423, 1263, 1260, 1441, 6527, 1261, 1262, 3020, 3155, 3156, 1301])

/** Lowercase tokens encode underscore-delimited words in packed symbols. */
export const ERROR_NAME_WORDS = 'NOT INVALID OBSOLETE ER ERROR WARN TABLE NO CANT LH LOG IN SUPPORTED PARTITION BINLOG CANNOT DEPRECATED WRONG COLUMN DEFINITION FAILED COMPONENT REPLICA UNSUPPORTED GTID VALUE TABLESPACE UNKNOWN AUDIT ENCRYPTION INNODB ALLOWED MISSING PASSWORD OPERATION INDEX CHANGE CREATE JSON REPLICATION ENGINE TRANSACTION FUNCTION GENERATED NAME UNSAFE KEY WITH EXISTS SOURCE TOO RANGE USER MISMATCH WINDOW DEFAULT CONSTRAINT UNSTRUCTURED GROUP FILE FUNCTIONAL JDV MODE FORMAT PLUGIN BULK TYPE FOR OPTION SCHEMA SELECT ALTER EVENT COMPONENTS FIELD ACCESS CLIENT REGEXP UPDATE FAILURE VARIABLE ANONYMOUS INCOMPATIBLE DATA SYSTEM GEOMETRY LANGUAGE FOUND CHARACTER CHANNEL SET UNEXPECTED MULTIPLE READ FOREIGN KEYRING STATEMENT ARGUMENT EXCEEDED DROP ONLY DENIED DUPLICATE EXCEPTION SIZE VIEW CHECK EMPTY MASKING WITHOUT DISABLED PREVENTS REQUIRES LONG PRIVILEGE ARCHIVE ILLEGAL SERVICE INCONSISTENT LIMIT FILTER MASTER POLICY REASON SRS AUTO VERSION ATTRIBUTE CONVERSION REFERENCED TO MAX ROW PARSER TABLES THREAD COMPRESSION CONSISTENCY IMPLEMENTED CLONE LOCK NULL OPEN APPLIER CHARSET RUNNING TIMEOUT LENGTH UDF GRANT AGGREGATE RECURSIVE TIMESTAMP RESOURCE ROTATION RPL OUT EXIST READER SERVER STRING SWITCH UNUSED ALREADY COMMENT EXCEEDS IGNORED PARQUET MUST USED ORDER QUERY RECOVERY ALGORITHM MANDATORY REGISTRATION AVRO MANY COMMAND CORRUPT DISABLE EXPLAIN CONNECTION SP NON COUNT INFER WRITE DOES LOAD ON ERR CLAUSE HEADER OBJECT SYNTAX OF POSITION BAD FUNC WHEN AFTER SLAVE COLUMNS HANDLER LOGGING PRIMARY COLLATION CONDITION DIFFERENT INCREMENT PARAMETER REFERENCE TRUNCATED AND USE LIST REDO STMT FIELDS SUBPARTITION NEXT TEMP AUTOINC FEATURE PARTIAL SPATIAL CONFLICT CREATION EXECUTED METADATA OVERFLOW ROLLBACK IS DUP CURSOR DELETE DOESNT DURING INSERT UNABLE VALUES CORRUPTED DEPENDENT INCORRECT MALFORMED RECURSION SECONDARY TEMPORARY TRANSFORM VARIABLES BIG TRG COL PATH MATCH PURGE CONVERT FILTERS SESSION DISALLOWED PARAMETERS REPOSITORY STATISTICS VALIDATION COMMUNICATION CONFIGURATION NATIVE NUMBER PURGED VECTOR EXTERNAL REQUIRED VAR FAIL HAVE INFO PART SAME STOP SUCH INSUFFICIENT SQL FILES FRAME PARSE START AVAILABLE COLLISION FILEGROUP HEARTBEAT PERSISTED PROCEDURE RECONNECT REPLICATE SPECIFIED FK GRP ROLE CHECKS COMMIT IMPORT PARENT SIGNAL UNLOAD DECIMAL FPARSER INSTALL INSTANT TRIGGER VIRTUAL ANNOTATIONS INTERRUPTED NONEXISTING DA OFF BOOST GTIDS PARAM STORE COMPLETE DATETIME EXCHANGE FULLTEXT GROUPING INTERVAL LATITUDE READONLY SETTABLE SUBQUERY AUTOEXTEND CONCURRENT HYPERGRAPH PARTITIONS TERMINATOR IMPLEMENTATION NONPARTITIONED BE ACTIVE BEFORE BUFFER GLOBAL HANDLE IGNORE LOADER LOCKED NESTED PACKET RECORD ROTATE SECURE STORED TARGET UNIQUE NET STD AUTH CRST HOST INIT UUID CACHE CHILD ENTRY LARGE USING CHANGED CURRENT DEFINED DEFINER GEOJSON LIBCURL PARSING PERSIST REPLACE ROUTINE'

/**
 * `@errno` starts a sequential range; each following entry consumes one code.
 * Comma-delimited entries hold a packed symbol and an optional SQLSTATE.
 * A trailing space represents 42000, the most common nondefault state.
 * Symbols begin with an implicit ER_ unless prefixed by !. Lowercase tokens
 * encode words, _ separates adjacent raw words and ~ encodes an empty word.
 * The decoder preserves entry order and alias precedence.
 */
export const PACKED_ERROR_TABLE = `@1000,\
!cdHASHCHK,\
!cdNISAMCHK,\
h,\
YES,\
imznv,\
imzg,\
imzDB,\
DBmznk,\
DBpjnk,\
!cdDBpjuq,\
DBpjRMDIR,\
!cdiuqnv,\
iFINDouREC,\
iGET_STAT,\
!cdiGET_WD,\
iqy,\
iranv,\
nvaox,\
ipdDIR,\
!cdipaWD,\
CHECKREAD,\
!cdDISK_FULL,\
uoni 23000,\
!cdeswCLOSE,\
eswpd,\
eswRENAME,\
eswst,\
nvsb,\
!cdFILSORT_ABORT,\
!cdFORMaox,\
GET_ERRNO,\
qaHA,\
niaox,\
aFORMnv,\
aKEYFILE,\
OLD_KEYFILE,\
raASyd,\
OUTOFMEMORY HY001,\
rotcSORTMEMORY HY001,\
!cdpbEOF,\
CONsre 08004,\
rotcRESOURCES,\
tezie 08S01,\
HANDSHAKEe 08S01,\
DBACCESSple ,\
olple 28000,\
hDBe 3D000,\
mpCOMe 08S01,\
teqze 23000,\
teDBe ,\
gnke 42S01,\
tege 42S02,\
sqUNIQe 23000,\
rrSHUTDOWN 08S01,\
teoke 42S22,\
mfoknjnu ,\
mfnuok ,\
mfSUMog ,\
mfmnsr 21S01,\
nmpxIDENT ,\
uoFIELDNAME 42S21,\
uoKEYNAME ,\
uozn 23000,\
mfokSPEC ,\
wne ,\
prsd ,\
NONUNIQg ,\
bnr ,\
pcPRIni ,\
nmsjKEYS ,\
nmsjniPARTS ,\
nmpxni ,\
nimgsuaEXITS ,\
BLOBsbASni ,\
nmvfFIELDLENGTH ,\
mfqjni ,\
READY,\
!cdNORMAL_SHUTDOWN,\
!cdGOTxf,\
SHUTDOWNxw,\
FORCING_CLOSE 08S01,\
IPSOCKe 08S01,\
hwimx 42S12,\
mfokTERMINATORS ,\
BLOBStuhTERMINATED ,\
TEXTFILEaREADABLE,\
nvnke,\
svwe,\
ohwe,\
mfSUBni,\
iREMOVE_ALLtz ,\
ipjokORni ,\
utwe,\
oogsb,\
hwiqt,\
KILLple,\
hqssb,\
nmvfpa,\
hzdLOGFILE,\
gayvodst,\
gayv,\
BLOBiwdnr ,\
mfDBng ,\
mfgng ,\
nmvfog ,\
mpe,\
mpwu ,\
mfPARAMCOUNTqowu ,\
mfvpqowu,\
mpg 42S02,\
okwxTWICE ,\
bnutftv,\
mlEXTENSION ,\
gsawdtj ,\
yynvFULL,\
mpoypa ,\
nmsjqs,\
nmsjtz,\
nmvfROWSIZE ,\
STACK_OVERRUN,\
mfOUTER_JOINru ,\
qzmglmx ,\
iFINDrg,\
iINITIALIZErg,\
rghPATHS,\
rgnk,\
iraLIBRARY,\
iFIND_DLzn,\
neazs,\
ziunBLOCKED,\
ziaPRIVILEGED,\
mvorno ,\
mvamt ,\
mvhvj ,\
oowe,\
imzqt,\
mfmnsrswqq 21S01,\
iREOPENg,\
btvtcqz 22004,\
one ,\
MIXtcnutftutz ,\
xprh ,\
TABLEACCESSple ,\
COLUMNACCESSple ,\
qarhodg ,\
rhmfziORno ,\
hwig 42S02,\
xpgrh ,\
amtsk ,\
tbe ,\
!cdUNUSED1,\
!cdUNUSED2,\
ABORTINGso 08S01,\
zeyxnmzo 08S01,\
zepdeFROM_PIPE 08S01,\
zeFCNTLe 08S01,\
zePACKETSrotcsc 08S01,\
zeUNCOMPRESSe 08S01,\
zepde 08S01,\
zepdxo 08S01,\
zeeswst 08S01,\
zestxo 08S01,\
nmpxrs ,\
giysBLOB ,\
giysqjtq ,\
!cdUNUSED3,\
mfmgng ,\
mfnimg ,\
mfMRGg,\
uozd 23000,\
BLOBniptrf ,\
tmiwdqz ,\
nmsjROWS ,\
pwtmni ,\
!cdhRAID_COMPILED,\
ooptnilSAFEny,\
nisuaEXITS ,\
pqhwig ,\
pqaqw ,\
iDO_THISusANnd 25000,\
eusxc,\
eusum,\
eusFLUSH_LOGS,\
!cdeusCHECKPOINT,\
NEW_ABORTINGso 08S01,\
!cdDUMPaqw,\
!cdFLUSHqfmcCLOSED,\
!cdmxREBUILD,\
nl,\
nlzepd 08S01,\
nlzest 08S01,\
FT_MATCHINGniaox,\
qyORyond,\
mpouoq,\
CRASHEDswUSAGE,\
CRASHEDswREPAIR,\
WARNINGaxwum,\
TRANSzlFULL,\
!cdtisawh,\
mkard,\
temk,\
souk,\
mkqt,\
nmsjnoCONNECTIONS ,\
paCONSTANTSpk,\
qyWAITre,\
qygFULL,\
pdpknd 25000,\
!cdpjDBnjpdqy,\
!cdmzDBnjpdqy,\
mfARGUMENTS,\
hPERMISSIONqomzno ,\
!cdUNIONqsltpDIR,\
qyDEADLOCK 40001,\
giysFT,\
mdADDpe,\
hqnqq 23000,\
qqunqn 23000,\
CONNECTqonl 08S01,\
!cdsdswqf,\
etgEXECUTINGsk,\
mfUSAGE,\
mfvwtctjlog 21000,\
ioonjREADLOCK,\
MIXINGamt,\
uoph,\
noqdREACHED ,\
SPECIFIColple ,\
LOCALoq,\
yroq,\
hnr ,\
mfmnodwb ,\
mfocodwb ,\
wbiynpd,\
itvoeHERE ,\
amaYET ,\
nlFATALeREADINGmc,\
mkryg,\
uyyrLOCALwb,\
mfwyDEF ,\
niREF_DOavjgREF,\
OPERANDtj 21000,\
yfh1qq 21000,\
mptytk,\
slHELP_DB,\
!cdCYCLICts,\
qjvl,\
qats 42S22,\
DERIVEDsawdALIAS ,\
ogREDUCED 01000,\
TABLENAMEamtHERE ,\
amazgny 08004,\
ugiwdqz ,\
tnrcnp ,\
!cdtiWASrd,\
!cdtiWASard,\
nmvfodUNCOMPRESS,\
ZLIB_Z_MEMe,\
ZLIB_Z_BUFe,\
ZLIB_Zote,\
CUTmnnuCONCAT,\
fnmFEW_RECORDS 01000,\
fnmsjRECORDS 01000,\
fqzqoNOTNULL 22004,\
fotrotcnn 22003,\
!fottt 01000,\
fzpOTHERtk,\
iri2COLLATIONS,\
!cdpjno,\
REVOKE_GRANTS,\
iri3COLLATIONS,\
iriNCOLLATIONS,\
oqunaSTRUCT,\
mptn,\
mkrySSL_PARAMS,\
!cdrrunlzazgny,\
fokRESOLVED,\
temkUNTIL_COND,\
muSKIPmk,\
UNTIL_CONDry,\
mfngodmx ,\
mfngodCATALOG ,\
!cdfQC_RESIZE,\
teFTmg,\
mpnizl,\
fHOSTNAME_WONT_WORK,\
mpSTORAGEnc ,\
fmetb,\
sqUPDATABLEg,\
uepu,\
oepvpg,\
DUPLICATEDmnloc,\
ttmfmn 22007,\
!cdnmMUCHqjrkCOLS,\
bswoo,\
mlPS,\
GET_ERRMSG,\
GETvcERRMSG,\
mpTIME_ZONE,\
fbrk,\
boyrs,\
fmtyxOVERFLOWED,\
CONFLICTING_DECLARATIONS,\
sphrjmz 2F003,\
sprvnk ,\
spsuarp ,\
sppjmi,\
spxvmi,\
spLILABELnp ,\
spLABEL_REDEFINE ,\
spLABELnp ,\
spUNINITwb 01000,\
spBADSELECT 0A000,\
spBADRETURN ,\
spBADSTATEMENT 0A000,\
ookmery ,\
ookmeTRANSLATED ,\
sdxo 70100,\
spmfhtcARGS ,\
spCONDnp ,\
spNORETURN ,\
spNORETURNEND 2F005,\
spteupsd ,\
spteupog ,\
spupnp ,\
spuprvra 24000,\
spupara 24000,\
spUNDECLAREDwb ,\
spmfhtcFETCH_ARGS,\
spFETCHhot 02000,\
spuoxu ,\
spuowb ,\
spuoCOND ,\
spuoCURS ,\
spioh,\
spSUBSELECT_NYI 0A000,\
tyamtlSF_ORvg 0A000,\
spVARCONDthCURSHNDLR ,\
spupthtk ,\
spCASEaox 20000,\
xinmvfnv,\
xitesz,\
xiEOFlrw,\
xieltr,\
xiEOFlmptr,\
pphsn,\
!cdFRMmpoc,\
mfta,\
NONUPDATEABLEmg,\
!cdppogDERIVEDru,\
ppogsy,\
ppogoq,\
ppogTMPTABLE,\
ppmftw,\
fppMERGE,\
fppptni,\
ppb,\
sphpjsp,\
!cdspGOTOlHNDLR,\
vgrvnk,\
vgsuarp,\
vgswppORucg,\
vgimyqq,\
vghwiqqlvg,\
hnrodok,\
DIVISION_BY_ZERO 22012,\
ttmfmnodok,\
qamnodoc 22007,\
ppNONUPDpq,\
pppqmi,\
PROCACCESSple ,\
RELAYkwc,\
!cdPASSWDrf,\
mpzcmc,\
IOsxkmxpd,\
mcvkPROHIBITED,\
FSEEKwc,\
mcvkFATALsx,\
kltv,\
kvkmpsx,\
RELAYkzj,\
hBINARYtl,\
RESERVEDtb,\
!cdWSASmi,\
!cdDIFF_GROUPS_PROC,\
!cdhnuodPROC,\
!cdscnjPROC,\
!cdtlPROHIBIT_CHANGINGtc,\
!cdhnvMAPPING,\
!cdmfMAGIC,\
PSsjxu,\
niwf0,\
ppCHECKSUM,\
ppMULTIUPDATE,\
pphutoktw,\
ppuqMERGEpp,\
mdno,\
XAER_NOTA XAE04,\
XAER_INVAL XAE05,\
XAER_RMFAIL XAE07,\
XAER_OUTSIDE XAE09,\
XAER_RMERR XAE03,\
XA_RBROLLBACK XA100,\
xpPROCrh ,\
PROCqjrhwc,\
PROCqjREVOKEwc,\
otnmpx 22001,\
spteSQLSTATE ,\
STARTUP,\
svFROM_FIXEDpoROWSqowb,\
imznonjrh ,\
mfmnodoc,\
gDEFzq,\
spuotk ,\
spawbARG ,\
sphRETSET 0A000,\
imzovta 22003,\
!cdmizzBREAKmc,\
mcnhzz,\
mcmzzzNEED_SUPER,\
!cdEXECtynjraup,\
tyHAShraup,\
xcamtlSF_ORvg,\
hnrodppok,\
sphva,\
nmvfSCALE ,\
nmvfPRECISION ,\
M_BIGGER_THAN_D ,\
mfqytcoug,\
CONNECTqopeotnl,\
sdswpeotnl,\
peotnlurrp,\
peotrsbimz,\
peotrsb,\
!cdimzFEDERATEDg,\
vglmfof,\
STACK_OVERRUN_NEED_MORE,\
nmpxBODY ,\
fipjnrKEYCACHE,\
nmvfDISPLAYWIDTH ,\
XAER_DUPID XAE08,\
xxneul 22008,\
ioosbglSF_ORvg,\
ppPREVENToo,\
PShva,\
spipaAUTOCOMMIT,\
!cduzzt,\
ppFRMhno,\
ppOTHERno,\
hwino,\
FORBIDofmy,\
qqunqn2 23000,\
hqnqq2 23000,\
sptewbSHADOW ,\
vghzt,\
OLDnvnz,\
spvaqd,\
!cdspPROCgsl,\
spmfng ,\
gNEEDS_UPGRADE,\
sphri ,\
qpPREPAREDtysrREACHED ,\
pprj,\
sqyaoksb ,\
giysSPKEYS,\
hTRIGGERSswouof,\
REMOVED_SPACES,\
udpdmi,\
USERNAME,\
HOSTNAME,\
mfrsrf,\
sqINSERTABLEg,\
ADMINmfMRGg,\
nmHIGH_LEVELtcNESTINGodog,\
ngBECOMESpr,\
AMBIGUOUSokTERM,\
perrnk,\
perrurrp,\
qaHAmzoe,\
mbpwuve,\
mbmfuve,\
mbMAXVALUEe,\
!cdmbuae,\
!cdmbSUBPART_MIXe,\
mbmfhwfe,\
mbmfhSUBPARTe,\
mfEXPRlmbtfe,\
!cdhCONST_EXPRlnnORtwe,\
okaoxwfe,\
!cdtwtctzpklHASHe,\
qcmbwee,\
mbtfamte,\
yjsaynzse,\
nnaINCREASINGe,\
qcoctcFUNCTIONSe,\
pcDEF_CONSTltwwfe,\
mbzne,\
MIXtke,\
mbazse,\
nmsjyje,\
uae,\
imztknv,\
BLOBoklwftfe,\
zdniNEED_ALLtzlPF,\
hPARTSe,\
mbMGMTswym,\
peniswPARTITIONED,\
pjmbsqEXISTENT,\
pjLASTmb,\
COALESCEpkswHASHmb,\
REORG_HASHpkswwgh,\
REORGhxue,\
pkswnntwmb,\
ADDmbSUBPARTe,\
ADDmbhNEWmb,\
COALESCEmbhmb,\
REORGmbarp,\
wgngmb,\
hmce,\
CONSECUTIVE_REORGyj,\
REORG_OUTSIDEnn,\
mbneop,\
!cdwfSTATEe,\
LIMITEDwfnn,\
oaunaLOADED,\
mfmn,\
hmbodGIVENmn,\
wroepkONCE,\
mzwrmi,\
pjwrmi,\
moqjEXTENDe,\
mfpovw,\
poule,\
ohwrmi,\
mcqqtlmi,\
!cdmcqqmfgDEF,\
!cdmcqqRBRqoSBR,\
oirvnk,\
!cdoixvmi,\
oisuarp,\
!cdoiioh,\
!cdoipjmi,\
oiybaPOSITIVE_ORnmvf,\
oiENDSypSTARTS,\
oiEXEC_TIMElTHE_PAST,\
!cdoiragmi,\
!cdoiNEITHER_M_EXPR_NOR_M_AT,\
!cdvhsrurvjuw,\
!cdmdsvFROMg,\
!cdoimduq,\
!cdoiCOMPILEe,\
oiwgng,\
!cdoiotnmpx,\
pjmxwy,\
fmetbnjVER,\
!cdistqykg,\
iqykg,\
pepmniOLDru 23000,\
vhsrurvjPLEASEoo,\
!cducgpvrtrotcRBR,\
zbnepvrtmcnz,\
!cdNDBirtmcnz,\
mbhvc,\
mbCONST_DOMAINe,\
mbneunamt,\
!cdDDLkeru,\
qzluvLESS_THAN,\
mfmbng,\
imyTX_CHARACTERISTICS 25001,\
uoznAUTOINCREMENT_CASE,\
!cdoiMODIFY_QUEUEe,\
oipawbe,\
mbMERGEe,\
!cdiACTIVATEk,\
!cdRBRawp,\
BASE64_DECODEe,\
oivaFORBIDDEN,\
!cdEVENTS_DBe,\
pkINTEGERSmt,\
UNSUPORTEDknc,\
tekpg,\
iRENAMEkg,\
mfPARAMCOUNTqovvFCT ,\
mfvpqovvFCT ,\
mfvpqozbFCT ,\
vvFCTngwq,\
uoznnjning 23000,\
mcvkEMFILE,\
oimdmzlTHE_PAST,\
oimdohlTHE_PAST,\
!cdtiINCIDENT,\
hmbodGIVENmnSILENT,\
mcnhpg,\
mcFATALe,\
!cdtiRELAYkpdop,\
!cdtiRELAYkstop,\
!cdtimzoiop,\
!cdtiqfCOMop,\
mctlIMPOSSIBLE,\
pphuiCTX,\
ppbuiCTX,\
!cdSRbuiCTX,\
vguwnv,\
vghuiCTX,\
vgbuiCTX,\
oibuiCTX,\
vgirag,\
!cdimzSROUTINE,\
!cdNEVERsb,\
hnzDESCRIPTIONoiypmcpg,\
mksloi,\
!cdsvotbmgru,\
kvkhnv,\
XA_RBTIMEOUT XA106,\
XA_RBDEADLOCK XA102,\
NEED_REPREPARE,\
!cdDELAYEDama,\
!fhsouk,\
!foery,\
oauqBUILTIN,\
!foaBUSY,\
oqunyd,\
fncndum,\
!cdtiwsop,\
mkwsmnrotcnn,\
NDBnbofe,\
uhFNwne,\
EXCEPTIONSste,\
nmpxgrw,\
nmpxokrw,\
tfINEXISTENTngwq ,\
DATABASEng,\
gng,\
mbng,\
uang,\
vcng,\
RENAMEDng,\
nmsjyhTRXS,\
!fsqASCII_SEPARATORaqw,\
DEBUG_SYNCre,\
DEBUG_SYNC_HITqd,\
uoxfpa ,\
xff 01000,\
xfaox 02000,\
xfpn,\
RESIGNALptyotk 0K000,\
xftetooc,\
!fCOND_ITEMtt,\
COND_ITEMnmpx,\
mpLOCALE,\
mkytrrIDS,\
!cdsdzlpu,\
wgngmbok,\
mbmgtwe,\
mfocmgmne,\
nmsjmbtftze,\
MAXVALUEluvl,\
nmsjuve,\
qqSINGLEmboke,\
okocamtASmbok,\
mbtznmpx,\
mcqqnctutync,\
mcqqnytutync,\
mcnhtutync,\
mcqqINJECTIONtutync,\
mctynytuqqnc,\
mcqqINJECTIONtutyny,\
mcpcENGINEStuSELFtlnc,\
mcnhqd,\
!cdUNUSED4,\
mcnhoug,\
mcnhudtj,\
mcnhrg,\
mcnhouoq,\
mcnhoune,\
mcnhNONTRANSthTRANS,\
MESSAGEtupg,\
!cdtiqmmi,\
mkimzqm,\
INSIDEndpvrtmcnz,\
virf,\
fmetbhREPLACEMENT,\
mfvvgSTRUCTURE,\
mfPERFSCHEMA_USAGE,\
fI_S_SKIPPEDg,\
INSIDEndpvrtmcDIRECT,\
zbnepvrtmcDIRECT,\
ugsawdGEOMvh ,\
nmpxmxrw,\
qyABORTED,\
otrotcnn 22003,\
!cdmfSPVARoclqd,\
mcnhpcENGINEStuSELFtlnc,\
mcnhMIXEDpg,\
INSIDEndpvrtwkkBIN,\
zbnepvrtwkkBIN,\
mipdFROM_PARnv,\
uvunaINToce,\
olplhmve 28000,\
!cdpamvzgoa,\
!cdrhoanonk,\
TRUNCATEqawy ,\
oaunPERMANENT,\
mkwsmnrotcnnMIN,\
mkwsmnrotcnnqp,\
tyzlFULL,\
MULTIooniuh,\
gNEEDS_REBUILD,\
!foeBELOWqd,\
mxmgnmpx,\
elxlBODY,\
elmpxlBODY,\
mxsl,\
UNDOyynmvf,\
mcnhutytog,\
mcnhutogoo,\
mcnhzyog,\
mcnhmzytog,\
mcnhmzzyog,\
mcnhooyt,\
oahUNINSTALL,\
oahxj,\
mcnhstudog,\
mcnhmzogud,\
mcnhutTWO_KEYS,\
glwypq,\
mlnc,\
mcnhudaFIRST,\
mdsvFROMgV2,\
nlDELAYmnrotcnn,\
pkFDtuRBR_EVENTSmtlmcpg,\
mbxytpoe,\
mbxywfg,\
mbxyucg,\
mbINSTEADtcua,\
mpmb,\
qstpuk,\
qqsuavjmb,\
mczlpoGREATER_THANqp,\
fmxaAPPLICABLE,\
mbxypeni,\
!cdhwinimn,\
rnweotnmpx,\
!cdNETWORKpdoiCHECKSUMop,\
!cdmcpdoiCHECKSUMop,\
mctyzlpoGREATER_THANqp,\
iooglmzgog,\
mbsyswym,\
qqsuavjGIVENmbpa,\
!cdhwimb~ru,\
myrnwevqop,\
WARNINGaxwumnjCREATEDucg,\
WARNINGaxwumnjDROPPEDucg,\
MTAueunama,\
MTA_UPDATED_DBS_GREATERqp,\
MTAiPARALLEL,\
MTAqcot,\
xzamanjPARTITIONING,\
xqbtovw 35000,\
INSECURE_PLAIN_TEXT,\
INSECUREmynl,\
pepmninjzmwe 23000,\
pepmniptzmwe 23000,\
SQLTHREADnjzamk,\
gHAShFT,\
oqayelSF_ORxl,\
oqayelnd,\
!cdmmubunalmmubtw,\
!cdimymmublnd,\
papgmdINVOKEne,\
mmubiynAUTOMATIC_IFmmubtwunsqqz,\
!cdSKIPPING_LOGGEDnd,\
uzmmpaSPECIFICATION,\
uzmmpaENCODING,\
uzmmSPECIFICATION,\
GNO_EXHAUSTED,\
temkqjtd,\
qjtdpwmmnyaxr,\
iDO_IMPLICITxclTRXtgmmubunpa,\
mmnyswpwENFORCEmmqvsw,\
!cdmmnypwmc,\
ipammubqommtgmmnyunxr,\
ipammubqoortgmmnyunsw,\
ipammubtwqosqqztgmmnyunxr,\
!cdoxmmoitgmmnyunxr~ru,\
mmnhsqTRANSACTIONALg,\
mmnhmzog,\
!cdmmnhmzpjucglnd,\
mmnyCANpkmyONE_STEP_AT_A_TIME,\
nlHASvxwaxt,\
ipammubtgOWNINGmm,\
mpsnnz,\
iEXECUTElpdpknd 25006,\
nmpxgmbrw,\
mkvu,\
msFTqd,\
mshFTucg,\
msFTmfDOCIDmg,\
msFTmfDOCIDmx,\
msONLINEknmvf,\
mpohsf,\
mpohqy,\
MTAmynliRUNnjGAPS,\
MTAseop,\
MTA_RESET_WORKERS,\
vhsrurvjuwV2,\
mkSILENT_RETRYnd,\
DISCARDwyxbrd,\
gofnp,\
gloumo,\
IOpde,\
IOste,\
momu,\
monk,\
moDISCARDED,\
INTERNALe,\
msxde,\
msmxsl,\
bYEARmgrf,\
aVALIDmv,\
samymv,\
wyhmxzm,\
wyhmxxe,\
wywcADDou,\
wymdraxe,\
wyuyoe,\
wyuong,\
mvnz,\
wymgmdpj,\
wymgmdpjzm,\
wymgaqz,\
uomx,\
wymgmdmy,\
wymgmdmyzm,\
!cdUNUSED5,\
uzyx,\
pdpkny,\
mmubocUNDEFINEDmm,\
oqayelsp,\
!cdipammvxtgmmnyunxr,\
ipammvxtgmmujunapr,\
ipammvxtgOWNEDxtunapr,\
mmvxWASzq,\
mmujWASzq,\
mctynytuhREPLqs,\
ohmwama 0A000,\
ohmwamaqh 0A000,\
ohmwamaqhCOPY,\
ohmwamaqhmb,\
ohmwamaqhwyRENAME,\
ohmwamaqhmgoc,\
ohmwamaqhwypq,\
!cdUNUSED6,\
ohmwamaqhNOPK,\
ohmwamaqhud,\
ohmwamaqhHIDDEN_FTS,\
ohmwamaqhmyFTS,\
ohmwamaqhFTS,\
!cdwkmkSKIP_COUNTERayelmmny,\
uomplmx 23000,\
IDENT_CAUSESnmpxvi,\
ohmwamaqhaqz,\
samymvLOGIN,\
qqlmfmb,\
MTAoiBIGGER_PENDING_JOBSpoqp,\
!cdmshFT_USESqr,\
mcLOGICAL_CORRUPTION,\
fvkkltv,\
fvkkunyo,\
qjtquh,\
!fswBLOCKHOLElRBR,\
mkCMzjvq,\
mkAMzjvq,\
olplmynoe 28000,\
mspdpk,\
whmkwkqtre,\
whmkIOqtre,\
gsl,\
ucnvstop,\
msFT_AUXaHEX_ID,\
OLD_TEMPORALS_UPGRADED,\
msFORCEDse,\
AESbIV,\
oamdynUNINSTALLED,\
mmnhmcSPLITTABLEpgtuASSIGNEDmm,\
mkHAS_MORExtTHANnl,\
muni,\
!fNAMED_PIPEolEVERYONE,\
@3000,\
nvsl,\
eswnl,\
!cdqce,\
STORAGEncaLOADED,\
GET_STACKEDxqptyotk 0Z002,\
fLEGACYtbCONVERTED,\
mcnhxzoa,\
mdDISCARDvcg,\
wyDEPTHpi,\
vhsrurvjPLEASEooV2,\
fxlurwdCREATED,\
qnvgsuarp,\
snama,\
bokpo,\
muHAmzoe,\
ncrotcMEMORY,\
mvEXPIREorno,\
mkwkqtsawh,\
hFT_MATERIALIZEDyf,\
msUNDOkFULL,\
bphodLOGARITHM 2201E,\
mkozIOqtsawh,\
fraucqssaynZERO,\
fpknlknvhPOS,\
sdre,\
sqROogsmTIMER,\
uotwzn,\
!cdwknyhEFFECT,\
riscodUNION,\
riscsqAGGsd,\
mkWORKER_STOPPED_PREVIOUS_THDe,\
!cdDONT_SUPPORTmkPRESERVExcsc,\
rrOFFLINEny,\
GIStpSRIDS,\
GISmlph,\
GISmpe,\
GISmppn,\
GISbot 22023,\
xsovprINPUTpn,\
xsovCENTROIDpn,\
xsovOVERLAYbINPUTpn,\
xsovTURNwepn,\
xsovSELF_INTERSECTION_POINTpn,\
xsovmppn,\
zfteALLOCe,\
zfDOMAINe,\
zfrfe,\
zfbph,\
zfrotcnne,\
zfule,\
zfnne,\
zfUNDERFLOWe,\
zfLOGICe,\
zfRUNTIMEe,\
zfmppn,\
GISotmfENDIANESS,\
mynlmvrf,\
noqymfng ,\
noqyDEADLOCK,\
zyINACCESSIBLE_ROWS,\
ohmwamaqhGIS,\
qanowb ,\
mmnyxr,\
!cdmlBYnbqt,\
uyoc,\
oklscaog,\
rilscaog,\
brnWILDgqePATTERN,\
zeOKyxnmzo 08S01,\
bnaot,\
bzumuMEMBER,\
bzumfoc,\
bzuUNSPECIFIED,\
DIMENSIONml,\
mkozsuarp,\
!cdtipcCHANNELSziPORT,\
mkozngbORnmpx,\
mkNEWozmfvq,\
!cdtiozuq,\
mkpcCHANNELS_CMD,\
mkqpCHANNELSpi,\
mkozsawh,\
mkozard,\
mkozWASrd,\
mkozWASard,\
mkozwkqtsawh,\
mkozwkSKIP_COUNTER,\
mfoknjnuV2,\
MIXtcnutftutzV2,\
fmeSYSVARoo,\
fmeSQLMODE,\
mdkufpjDATABASEnjmm,\
nunbvu,\
nunbrd,\
nunbrbzje,\
nunbwhrbqtre,\
nunbvtLAYERvne,\
nunbvtLAYER_JOINe,\
ypDMLvse,\
pvoqptRBR,\
RUN_HOOKe,\
ndumusxc 40000,\
nfmgneunamt,\
mlohINPLACEswxmmg,\
mfwyoeodnfmg,\
sqnrmnodnfmg,\
mlACTIONswnfmg,\
nfmgsqPRIOR,\
uxBYnfmg,\
nfmgREFqjINC,\
ueawp,\
ipammny,\
itvqjtdnjmmnyxr,\
!cdiwwornjqjtd,\
!cdiwwornjmmnysw,\
!cdiwwmmnjmmnyxr,\
iENFORCEmmqvnjONGOINGmmVIOLATING_TX,\
ENFORCEmmqvfnjONGOINGmmVIOLATING_TX,\
ACCOUNT_HAS_BEENyv,\
mfmong ,\
mounapr,\
mfnvng,\
xsovqcTURNSpn,\
fOPTIMIZER_HINTtbe,\
fteqpEXECUTION_TIME,\
fmlqpEXECUTION_TIME,\
fCONFLICTING_HINT,\
fmpQBng,\
UNRESOLVED_HINTng,\
fswMODIFYINGmmujg,\
PLUGGABLE_PROTOCOLskama,\
LOCKINGqbmfng ,\
LOCKINGqbDEADLOCK,\
LOCKINGqbre,\
GISqpPOINTSlovOVERFLOWED,\
wknyMERGED,\
!cdVTOKENoaTOKENnp,\
!cdVTOKENoaTOKENaox,\
ipaoqtgOWNINGmm,\
mkozmwamt,\
bnaTEXT 22032,\
bnaTEXTlxu 22032,\
bnaBINARYot,\
bnavi ,\
bnarc 22032,\
bnarclne 22032,\
bocodna 22032,\
bCASTqona 22032,\
bnavirc ,\
bnaviWILDCARD ,\
namnnmvf 22032,\
naninmvf 22032,\
nasbASni ,\
naVACUOUSvi ,\
nateONE_OR_ALL_ARG ,\
NUMERICnamnrotcnn 22003,\
bnamnodCAST 22018,\
naDOCUMENTnmDEEP 22032,\
naDOCUMENTqzni 22032,\
zaTRANSPORTwa,\
hzaTRANSPORTS_CONFIGURED,\
puSTORAGEnc,\
nosuarp,\
norvnk,\
mqAPI_ABORT,\
bnaviARRAY_CELL ,\
BUFPOOL_RESIZE_INPROGRESS,\
uepuSEE_DOC,\
rrISNTwp,\
vnWAS_KILLED,\
CAPACITYpi,\
CAPACITYpilnnOPTIMIZER,\
!cdgNEEDS_UPGwf,\
iWAITodujmmpaWHILE_OWNING_Amm,\
mdADDpeBASEvhxm,\
mdmzxmmxns,\
eswMODIFYINGmmujg,\
qyREFUSED_BYnc,\
mlohONLINEswxmmg,\
qfnirmamaBY_SE,\
!cdqfnirmeBY_SE,\
qfnirmmcmi,\
qfnirmSE_UNAVAILABLE,\
momdENCRYPT,\
bmroe,\
mdFINDnilpf,\
CAPACITYpilqr,\
mlohmrINPLACE,\
pfrgpfqbe,\
nomgOLDrf,\
iRESETnl,\
nunbqpnupo,\
mdADDpeBASEvhzb,\
gqn,\
!cdmbncmeodg,\
!cdfzpGEOMFROMWKBqopaSRID_ZERO 01000,\
!cdfzpGEOMFROMWKBqopaSRID 01000,\
XA_RETRY,\
pfAWSrgAWS_KMSe,\
mcnhXA,\
rge,\
pfMIGRATIONop,\
pfolple ,\
pfMIGRATION_STATUS,\
!cdoamiqoraqs,\
!cdoamiqorag,\
!cdmqkhpfoaINSTALLED,\
!cdmqkmrmvHASaBEENpa,\
!cdmqkCOULDamzAESni,\
!cdmqkmrmvmdynFETCHED,\
!cdmqknaFILTERINGaENABLED,\
!cdmqkrgwjpy,\
!cdmqkSUPERpywa,\
!cdCOULDaREINITIALIZEmqkvm,\
!cdmqkrgbphoc,\
!cdmqkrgbphsr,\
!cdmqkHASaBEEN_INSTALLED,\
!cdmqkrgpdbqpARRAYrfARGoc,\
mqkrgpdbqpARRAYrfARGmn,\
!cdmqknaqezwe,\
!cdmqknaqengmdynpr,\
!cdmqknanongmdynpr,\
!cdmqknaqesuank,\
!cdmqknoFIRSToysaynALPHANUMERIC,\
!cdmqknongboy,\
!cdmqkzingboy,\
!cfmeMAXDBwknyodrk,\
!cdXAnbvm,\
!cdiraek,\
!cdyaswrklDST,\
!cdiworrNAMED_PIPE,\
stparxqd,\
!cdmeTLSqkvn57,\
!cdfmeTLSqk57,\
!cdfmfvvgSTRUCTURE,\
AESbKDFng,\
AESbKDF_ITERATIONS,\
!fAESnipo,\
AESbKDFoepo,\
@3500,\
UNSUPPORT_COMPRESSEDvcg,\
ACLmwmi,\
mlmxsf,\
hwiDB 42Y07,\
nmvfENUM,\
nmpxpaENUMmn,\
bDDta,\
UPDATING_DDg,\
bDDtaID,\
bDDtang,\
momunjng,\
nmpxzzrw,\
spsvmi,\
bBITWISE_OPERANDSpo,\
bBITWISEriOPERANDSpo,\
fmlHINT,\
pbovoc 22S01,\
qiwne SR002,\
qiPROJtrmu SR003,\
fqiaox 01000,\
qiaCARTESIAN 22S00,\
qiaCARTESIAN_UNDEFINED SR001,\
PKmxiynINVISIBLE,\
mpAUTHID,\
mixarh,\
raxaqs,\
minrROLES,\
ojhSCHEME,\
ojhSCHEMEqb,\
ojisv,\
xaaGRANTED,\
miREVOKExa,\
RENAMExa,\
ojiACQUIREqbyl,\
ojiSATISFY_DEPENDENCY,\
ojsviREGISTERqbyl,\
ojsviINITIALIZE,\
ojxgaLOADED,\
ojxgiDEINITIALIZE,\
ojiRELEASEqb,\
ojxgiUNREGISTERqb,\
ojixg,\
fxgTHEawt,\
mjguy,\
mjMANIPULATEqqmi,\
ojxgpmlnu,\
ipammvxDUE_SETS_CONSTRAINTS,\
mdqynoMANAGEMENT_CACHES,\
qiaox SR001,\
oqawt,\
unsdbsy,\
uuqoxvvr,\
houofol,\
houmool,\
hougol,\
hougolodDICTIONARYg,\
hougolodoug,\
hougolodg,\
boeni 22023,\
boemn 22023,\
boenimnPAIR 22023,\
boewooy 22023,\
boeENDoy 22023,\
boeCHARACTERS 22023,\
pmoeni 22023,\
fqiaoxAXISsc 01000,\
holqovvFCT,\
RESETnlqomnrotcnn,\
UNRESOLVEDgqy,\
pmgqy,\
mcnhSKIPyv,\
mcnhNOWAIT,\
qyNOWAIT,\
CTErjpwUNION,\
CTErjpwNONRECURSIVE_FIRST,\
CTErjFORBIDS_AGGREGATION,\
CTErjFORBIDDEN_JOINsc,\
CTErjpwSINGLEts,\
rtTMPnc,\
nqhwinq,\
nqCIRCULARITYlnqGRAPH,\
nqhzmPARTITIONING,\
nqhINHERITwm,\
nqhREDEFINEscBY,\
nqwmwoqa,\
nqwmENDqa,\
nqwmqa,\
nqnnwmscoc,\
nqnnwmTEMPORALoc,\
nqnnwmNUMERICoc,\
nqnnBOUNDaCONSTANT,\
nqpmng,\
nqqascBY,\
nqbnqtftv,\
nqbnqtfALIAStv,\
nqywnqtftvlnqSPEC,\
nqROWSybtv,\
nqhnuscru,\
nqsnna,\
nqneIGNORESwm,\
WL9236_NOWru,\
bhtcARGS,\
oklyaanuBY,\
nmpxmorw,\
ncipjg,\
ncipjmug,\
mouoFILENAME,\
DBpjRMDIR2,\
IMPhwlMATCHED,\
IMPofsuarp,\
IMPgrvnk,\
IMPosMYSQLDqk,\
IMPosDDqk,\
IMPosSDIqk,\
fbHINT,\
wbsuarp,\
LONGITUDErotcnn 22S02,\
ycrotcnn 22S03,\
aqwodGEOGRAPHICqi 22S00,\
qapyLEVEL,\
houppol,\
mjqeFLABBERGASTED,\
wfEXPRnmpx,\
rgpjDYNAMICALLY_REGISTERED,\
uuqoxvmgvr,\
uuqooomgvr,\
uuqopjmgvr,\
uuqoBUILD_HISTOGRAM,\
sgxa,\
mumonv,\
zxpkolple ,\
!cdCMD_NEED_SUPER,\
vilDATADIR,\
qxDDLlPROGRESS,\
qxnmsjyhCLONES,\
rbkoivse,\
CTEqpvaDEPTH,\
aHINT_UPDATABLEoq,\
CREDENTIALS_CONTRADICTqoHISTORY,\
WARNINGmvHISTORY_CLAUSES_VOID,\
omsuaSUPPORT,\
I_S_SKIPPEDmo,\
moncnp,\
mfSRIDodmg,\
mdohSRID_DUEqomx,\
fmcufUPDATESpu,\
!cdfmcV1qqEVENTSpu,\
fmcufUPDATES_SUGGESTSufIMAGES,\
COULDaAPPLYnaDIFF,\
uwnaDIFF,\
rlnunk,\
rlnuank,\
bVCPU_ID,\
bVCPUnn,\
bqtPRIORITY,\
vomw,\
rlnuBUSY,\
rlnupu,\
ueml,\
qlry,\
bqtID,\
rlnuBINDmi,\
btvtcFORCEoe,\
nunbskop,\
SDImwmi,\
munagmn 22035,\
mfnagmn 2203F,\
TFsawdALIAS ,\
TF_FORBIDDEN_JOINoc,\
JTmnrotcnn 22003,\
JTqpywvi ,\
mvEXPIRATIONamaBYzgMETHOD,\
bzuCRSaTOP_LEVEL,\
teqzeary 23000,\
!fUSELESSugmx,\
DISK_FULL_NOWAIT,\
wnelDIGEST_FN,\
UNDISCLOSEDwnelDIGEST_FN,\
ofDIRnk,\
ofDIRmu,\
ofDIRmzmi,\
ofDIRmp,\
pkqwodSRID_0tu4326 22S00,\
!cdmcEXPIREkDAYStuSECSsbTOGETHER,\
onyqul,\
onqaph,\
onmxOUTOFBOUNDSe,\
onINTERNALe,\
onRULEtb,\
onteESCAPE_SEQUENCE,\
onUNIMPLEMENTED,\
onMISMATCHED_PAREN,\
onteyb,\
onqpLT_MIN,\
onbBACK_REF,\
onLOOK_BEHINDqd,\
onmuCLOSE_BRACKET,\
onbnn,\
onSTACKul,\
onTIMEro,\
onPATTERNnmvf,\
ipaekqb,\
prPIPELINEodekqb,\
mjqeDIAGNOSTICS,\
aqwodCARTESIANqi 22S00,\
aqwodPROJECTEDqi 22S00,\
NONPOSITIVE_RADIUS 22003,\
RESTARTrrmi,\
qimusgql SR006,\
qipcqlDEFINITIONS SR006,\
qingiynprOR_WHITESPACE SR006,\
qiORGANIZATIONiynprOR_WHITESPACE SR006,\
qiIDrvnk SR004,\
fqiIDrvnk 01S00,\
iMODIFY_SRID_0 SR000,\
fRESERVED_SRIDnn 01S01,\
iMODIFYqisbBYmg SR005,\
qiboylql SR006,\
qiqlrsnmpx SR006,\
meUTF8_ALIAS,\
meNATIONAL,\
bnrUTF8MB4tn,\
uuqoCOLLECTkSTATUS,\
RESERVEDmong,\
uuqopaoe,\
mkPOSSIBLY_DIVERGEDthDDL,\
qiaGEOGRAPHIC 22S00,\
POLYGONnmzo 22023,\
ugzdmx,\
mxocamaodugmx,\
wymdpjxe,\
ovxuLONGITUDErotcnn 22S02,\
ovxuycrotcnn 22S03,\
wymdtvxmmg,\
wyhmgxe,\
ipaeSUPPRESSIONtw,\
qiGEOGCSbAXES SR002,\
qibSEMI_MAJOR_AXIS SR002,\
qibINVERSE_FLATTENING SR002,\
qibANGULAR_UNIT SR002,\
qibPRIME_MERIDIAN SR002,\
vdnlqiama 22S00,\
vdzcqiama 22S00,\
vdnlqimuTOWGS84 22S00,\
vdzcqimuTOWGS84 22S00,\
ucgpvrtvnmcnz,\
ucgpvrtyrmcnz,\
rdrbpvrtyrmcnz,\
ommmnhmzpjucglTRXlSBR,\
!cdXAimzMDL_BACKUP,\
gptPK,\
fotttnwmx 01000,\
fotrotcnnnwmx 22003,\
nwmxswnaORovne ,\
nwmxREFqjtq,\
mdpjmgnwmx,\
nwmxtmni,\
nwmxswLOB,\
nwmxneunamt,\
xznwmx,\
ugnwmx,\
mfnimgnwmx,\
nwmxswok,\
nfmgNAMEDneunamt,\
nfmgqqmn,\
nfmgve,\
uxBYnrnfmn,\
nrVALnfsqPRIOR,\
nrVALnfREFqjINC,\
nrVALnfneunamt,\
nrVALnfNAMEDneunamt,\
nrVALnfqqmn,\
nrVALnfve,\
nrAS_VALnf,\
mlACTIONswnrVALnf,\
mmnhohADDvhnjnrEXPRESSION,\
wymdmync,\
fmenopaEXPR,\
fmeUTF8MB3tn,\
fmeywrwtb,\
wyostj,\
GR_HOLD_WAITre,\
GR_HOLD_KILLED,\
GR_HOLD_MEMBER_STATUSe,\
rnmrmiqoFETCHni,\
rnmrniaox,\
rnmrpfbni,\
rnmrsze,\
rnmrmiqoyzLOGS,\
rnmrninkpb,\
rnmrmiqoGENERATEni,\
rnmrmiqoxvni,\
rnmrmiqoREMOVEni,\
rnmruuqomyoe,\
rnmrqfnisemi,\
SLOWknyrytgatlqonv,\
wzTRXqvamt,\
wzTRXqvyp,\
wzTRXqvthswTRX_BEGIN,\
wzTRXqvBEGINamt,\
nwmxqqmnunamt,\
rnmrmiqoENCRYPT,\
PAGE_TRACKINGaSTARTED,\
PAGE_TRACKINGnnaTRACKED,\
PAGE_TRACKINGmdvk,\
rnmrmdyzmcqfni,\
mcqfniserotcCOMBINATION,\
mcqfnirmwcqoOPERATEni,\
mcqfnirmwcqoyzLOGS,\
mcqfnirmwcqoREENCRYPTk,\
mcqfnirmwcqoCLEANUPruKEYS,\
mcqfnirmwcqoCLEANUP_AUXni,\
sqBOOLEAN_EXPRodpqns,\
mgpqnsREFERENCES_OTHERmg,\
pqnsNAMEDneunamt,\
pqnsneunamt,\
pqnsve,\
pqnsqqmn,\
pqnsREFERSqjtqmg,\
pqnsVIOLATED,\
pqnsREFERSmpmg,\
pqnsaox,\
pqnsuong,\
pqnssyzpwyREFER_ACTIONmg,\
!fUNENCRYPTEDglENCRYPTED_DB,\
bmrREQUEST,\
mdpagmr,\
mdpaDATABASEmr,\
mdpamomr,\
momdynENCRYPTED,\
momdynDECRYPTED,\
moocmp,\
zcmoUNENCRYPTED,\
mdtvmrsy,\
bpcCLAUSES,\
mltvtcrhAS,\
UKNOWNzgID_ORolplodrhAS,\
uxBYnwmx,\
oaaEARLY,\
mstxkpzwoSUBDIRvi,\
mstxkpzwore,\
mstxkpzDIRSb,\
mstxkpzLABELaox,\
mstxkpzDIRpr,\
mstxkpzhwiDIR,\
mstxkpzDIR_CLASH,\
mstxkpzDIR_PERMISSIONS,\
mstxkpznvmz,\
mstxkpzyo,\
mstxkpzINACTIVE,\
mstxkpzmi,\
mstxkpzvn,\
zfREGEXe,\
bnaoc 22032,\
mdvlrs,\
uxBYmbtf,\
fmeFLOATqjtq,\
rniwhmkWHILEyvBACKUP,\
fmeFLOAT_DIGITS,\
fmeFLOAT_UNSIGNED,\
fmeINTEGER_DISPLAY_WIDTH,\
fmeZEROFILL,\
qxDONOR,\
qxPROTOCOL,\
qxDONORqk,\
qxOS,\
qxPLATFORM,\
qxrc,\
qxCONFIG,\
qxSYS_CONFIG,\
qxoavj,\
qxLOOPBACK,\
qxmr,\
qxDISK_SPACE,\
qxlPROGRESS,\
qxvo,\
mdrhROLESqoorno,\
vbncoa,\
SECONDmvmdynpr,\
DBolpl,\
xqzgIDnjounoPRIVlsgROLES,\
xqrnmmgmdra,\
ovlmprfUNIT SU001,\
xqoaxje,\
hvnuc,\
xqmpevw,\
mgmypo,\
onbCAPTUREnung,\
xqSSL_LIBRARYe,\
vbnc,\
vbncDDL,\
uyzrmv,\
muzrmv,\
zrmvawa,\
mvmdynRETAINEDswoamy,\
zrmvmdynRETAINED,\
ufREVOKESrp,\
mdrhouPRIVqosgxa,\
XAnbvm,\
mlwkny,\
onbFLAG,\
ufREVOKEtuDBrhBOTHnk,\
UNITaox SU001,\
bnamnodtfmx 22018,\
namnrotcnnodtfmx 22003,\
piMV_KEYS_NUM,\
piMV_KEYS_SPACE,\
nwmxotunnmpx 22001,\
mfMVImn,\
ftfmxaAPPLICABLE,\
wzrnrge,\
oommvxnjGR,\
yaswrklDST,\
gngCAUSESnmpxvi,\
mqkwjpy,\
!cdmqkmvHAS_BEEN_COPIED,\
xqwzrnSTARTEDqjREJOIN,\
SYSVARmyussd,\
GLOBSTATmyussd,\
wzrnMESSAGEqbzjop,\
mynlmfqusfom,\
mynlmfquLEVELom,\
mfqusfom,\
mfquLEVELom,\
mynlmfqusftwom,\
ompyxbnomdynor,\
ompyxbnosuarp,\
ompyxbnosl,\
ompyxbnoNEEDSrnrbPRIV,\
fxqpyaREGISTERED,\
ompfrgnib,\
ompfrgniocb,\
ompfrgninmpx,\
ompfrgniocnmpx,\
naofvsenjDETAILED_REPORT,\
xqrgbrcwx,\
xqrgbrc,\
xqrgbtn,\
xqrgbEXTENSIONphoc,\
pcCONSTRAINTSnjwgng,\
nsaox,\
ohnsENFORCEMENTama,\
gmnCONSTRUCTORsawdtj,\
gmnCONSTRUCTORmdwdnr,\
omsdopbsqqqnz,\
REQUIREqqnzbmn,\
miqoDETERMINE_IFxaunsg,\
miqoFETCHsgxatw,\
omLOCALwlpu ,\
IMPosCFGqk,\
xqOOM,\
xqrgbphqoparc,\
xqrgbRETURNocqoparc,\
pcINTO_CLAUSES,\
MISPLACED_INTO,\
noolplodnoACCOUNT_BLOCKED_BYmvqy,\
fmeYEAR_UNSIGNED,\
qxNETWORKyx,\
SDImwmimuyy,\
uxBYpqns,\
wzmwamtGRsawh,\
fmenagsweswpr,\
fmeINNER_INTO,\
fmeuvneALWAYSqz,\
fmewkCALCoxROWS,\
fmeoxROWS,\
munamn 22035,\
pcnauv 22034,\
HOSTNAMEnmpx,\
!cdfommembPREFIXni,\
nunbnoprMSG,\
nunbnosgMSG,\
nunbmvrf,\
yfvdREJECTED,\
xqwzrnseENDPOINTnz,\
xqwzrnseENDPOINTb,\
mfmnodwbPLUS_ACTIONABLEwf,\
pgamtthwond,\
peninjATOMICmzog,\
amtnjwond,\
bnaql,\
ncqlama,\
bnoqlna,\
mstxpu,\
mstxARCHIVING_ENABLED,\
MDLrotcRESOURCES,\
IMPLICIT_COMPARISONodna,\
nesuaSUPPORToypa,\
IMPOSSIBLErsqm,\
ofpdpk,\
rnASYNCwvmmnyxr,\
rnASYNCwvqjtdxr,\
smmmnypwASYNCwvxr,\
smqjtdpwASYNCwvxr,\
btrtv,\
oypanp,\
fwbmnmyama,\
bTIME_ZONEyb,\
bCAST,\
yiamaYET ,\
!cdfyiEXPERIMENTAL,\
xqhekqrCONFIGURED,\
xqekgpu,\
xqekpcvm,\
xqiraek,\
noqnASzt,\
mdnoqnASzt,\
REGEXvwnmvf,\
SPVAR_NONINTEGERoc,\
!fmlACLqspd,\
mcnhACLgpdlDML_DDL,\
whmkMONITOR_IOqtre,\
STARTINGmkMONITOR_IOqt,\
itvorqommnjmmnyasw,\
iCOMBINEorqommtuAUTOPOSITION,\
ASSIGNxtqoorTRANSACTIONSpwmmnysw,\
wkmkSKIP_COUNTERsbnjmmnysw,\
zpASSIGNxtqoorTRANSACTIONS_AS_LOCAL_ORzk,\
!cdpammqoANONtuWAIT_UNTILwkTHDthxt,\
ipawkthORypxtnjorqomm,\
orqommzkwgASnung,\
itvwgzkASnung,\
wzrnseozSTILLrd,\
msbygpomn,\
msosnjmo,\
msygporotcnn,\
mdtvygposy,\
xaGRANTEDqoITSELF,\
gsawdA_VISIBLEmg,\
msquop,\
fASYNC_CONN_FAILOVER_NETWORK_NAMESPACE,\
omINTERACTIONre,\
bCASTqoov 22S01,\
bCAST_POLYGON_RING_DIRECTION 22S04,\
GIStpSRIDS_AGGREGATION 22S05,\
RELOADpfop,\
SDI_GET_KEYSbmo,\
myrnSRCmfqusfpo,\
!cdfmeTLSqkodozCLI,\
itvwgzkASppmyzk,\
orqommzkwgASppmyzk,\
wzrnppmyzkwcGEToq,\
fADUITkqppotuPRUNE_SECONDS,\
fADUITkqppoCLOSEqoyzswpo,\
KERBEROSmzno,\
xjoauhom,\
xqekmjFLUSHmi,\
fwkthMTS_GAPS_GAPaCALCULATED,\
bASSIGNMENTzc ,\
mwamtswGRvb,\
wzrnFAILOVERozSTATUS_PROPAGATION,\
fmqknzUNIXrkpktgna,\
bMFAoawx,\
IDENTIFIED_BYml,\
boaodsh,\
oapwsh,\
MFA_METHODnk,\
MFA_METHODank,\
AUTHENTICATIONqgnp,\
oashDONE,\
bnoodsh,\
noshmi,\
MFA_METHODSbsc,\
MFA_METHODS_IDENTICAL,\
bMFA_OPERATIONSodPASSWORDLESSno,\
mynbnlhOPTIONSodmmpk,\
myREPnlismREQqqnznjmmpk,\
myREPnlismqjtdnjmmpk,\
myREPnlismmmpkptPOSITIONS,\
myREPnlismqjPOSptPOSITIONS,\
myREPnlGRoznjmmnyasw,\
itvmmpknjmmnyasw,\
fCsmmmpknjnlqjPOSbPOS,\
xqSSL_FIPSnye,\
mnrotcnn,\
xznjROLLUP,\
onmurl,\
fonzpnr,\
onmunv,\
fmetn,\
yhwuUSAGE,\
xqyrCONNqd,\
xqCONNqd,\
ohmwamaqhmgocxk,\
fSFrgngwq,\
mdvkmcnjBACKUPqy,\
nmsjWINDOWS,\
MYSQLBACKUPomMSG,\
rwCONTAINSbrs,\
mhCONTAINSbrs,\
iEXECUTEsknjASSIGNEDmmub,\
XAucg,\
msqpqqqk,\
!cdmsxkADDamaqppo,\
mwamtWHILEtmmyunrd,\
fmexxDELIMITER,\
fmeSUPERFLUOUS_DELIMITER,\
mdzxSENSITIVEve,\
fmdSECURELYzxSENSITIVEve,\
fvgrvnk,\
IFankmlvgnkswtpg,\
IFankmlrgvvFCTngwq,\
pamvzgoae,\
!cdREDUCED_DBLWRnvuw,\
!cdREDUCED_DBLWR_PAGEox,\
qibyctcORIGIN SR002,\
qibLONGITUDEtcORIGIN SR002,\
qiruPROJtrPRESENT SR002,\
GIPKmgnk,\
GIPKmiudmgnk,\
GIPKmgohamt,\
pjPKmgqopjGIPK,\
mzognjGIPKvolSBR,\
!cdxqEXPIRE_LOGS_DAYSry,\
CTErjaUNION,\
skBACKENDmiqoFETCH_SECURITY_CTX,\
skqbBACKENDmi,\
omnvpyodnbxb,\
nunbFORCE_MEMBERSskop,\
fmeIDENT,\
INTERSECT_ALLqpDUPLICATESpi,\
TPsdTHRS_PERwzrxTXN_THRqd,\
terknz,\
SHAPE_PRIDICTIONrg,\
qibHEIGHT SR002,\
qibSCALING SR002,\
qibZONE_WIDTH SR002,\
qibycPOLAR_STEREwbA SR002,\
fmeomhofoe,\
gapr,\
ghtmni,\
glSHAREDmo,\
mxOTHER_THAN_PK,\
svobotUNSORTED,\
obEXECUTORe,\
obrqzvzjmi,\
obrqzve,\
obrqrre,\
obrqvte,\
obsvotmi,\
obyumgnmvfodLEFTOVERyq,\
obyumje,\
obyunvCONTAINS_LESS_LINES_THANytsy,\
obqrmuENCLOSED_BY,\
obqrqqyqqpTOTAL_COLSpi,\
obqrCOPYyqpopi,\
obqrpbENDtcINPUT,\
obqrpbqqyk,\
obqrpbCHARthENDING_ENCLOSED_BY,\
obqrpbCHARthqzESCAPE,\
obqrpbCHARthmgyk,\
obqrINCOMPLETE_ESCAPE_SEQUENCE,\
svobotmi,\
svobotmfmnodok,\
svobotfqzqoNOTNULL,\
REQUIREgtmnipqGENERATEnjGR,\
imySYSwblpdpkny,\
msxkADDpjamaqppo,\
msxkADDamaqptz,\
ipawt,\
xjmjpaqzmn,\
xjmjparumn,\
fmenozsCOLLATIONS,\
noqyOVERLONGng ,\
fhSPACEqkrw,\
VALIDATEmvwjzqCHARACTERS,\
fmenjNOTE,\
iRUNskSERVICES_RECURSIVELY,\
fmqkqesetlpu,\
@6000,\
owmj,\
owmjawp,\
owmjmlow,\
owmjmdUNINSTALL,\
sphohow,\
!cdsnINTO_ANALYZEama 0A000,\
snINTO_IMPLICITnzama 0A000,\
snINTOnzama 0A000,\
qziynwtodyd,\
snINTOodsoama 0A000,\
msxdmfDROPPED_ENUMrf,\
msxdmfvwtcINDEXES_ZERO,\
msxdmfvwtcINDEXESnmHIGH,\
msxdpjvhuknp,\
msxdENUMqzykmu,\
SIMULATED_INJECTIONe,\
fmeDYNAMIC_PRIVlrh,\
obMULTIrqranvmi,\
obMULTIrqpdnvmi,\
obMERGEbCHUNK,\
obMERGEaALL_CHUNKS_CONSUMED,\
obWRITERzvzjmi,\
obWRITERzve,\
obSORTINGyust,\
obSORTINGyuWAIT,\
obrqranvmi,\
obsvgHASxkCOLS,\
obsvrl,\
obsvvbnc,\
obrqe,\
obrqnvurrp,\
obrqCOULDNT_RESOLVEzi,\
womkozbvu,\
mdEXECUTEltm,\
nmsjnuBY_MODIFIER_BRANCHES,\
fmenctbhREPLACEMENT,\
QUALIFYptnqne,\
mapknjyi,\
SPECIFIColpl,\
ipammubqoAUTOMATIC_TAGGEDtgmmnyunxr,\
mmubTAGmmnyxr,\
jvhaNULLABLE,\
jfvhmuaNULLABLE,\
jvhunpr,\
jvhunprf,\
jtemn,\
jxhmpsx,\
jxhOOMsx,\
jfxhROUNDING,\
jxhPRECISIONrxof,\
jrxMIN,\
jrxqp,\
jfrxMIN_TRUNCATING,\
jfrxqpTRUNCATING,\
jREALunNAN,\
jrotcnn,\
jxxnz,\
jftt,\
jmdvlrs,\
jrlPRINCIPALsx,\
jAWSzgsx,\
jCSVzwsx,\
jmgnpsx,\
jmgqpsx,\
jrcml,\
jrzxhqmsx,\
jrsnmpx,\
jrlPRINCIPAL_BUCKETsx,\
jhwlox,\
jprnv,\
jpmnv,\
jsiofDEPTHrxqp,\
jsisznp,\
jsiENUMmdvlrc,\
jsiENUMnp,\
jsiocmdvl,\
jsinvENDS_UNEXPECTEDLY,\
jsinvotsl,\
jsibUNION,\
jsibBLOCKpo,\
jsibBLOCKyysr,\
jnzszhMAGIC_BYTES,\
jsiszuksx,\
jsiszhof,\
jsihCODEClsz,\
jsibnglof,\
jsiDECODINGsx,\
jrzsqUTF8nvENC,\
jrzofnp,\
jrzqqnuporxqp,\
jrzmdLOCATE_OFFSET,\
jrzocmdvl,\
jrzmdLOCATEof,\
jssNUMvhnp,\
jOOM,\
jfssSKIPPED_LINES,\
jfssSKIPPEDwl,\
jssnvHAShot,\
jsshot,\
jsshwl,\
jfsstvnrvhNAMES,\
jrzmdpdsz,\
jssfGOTpn,\
jsimdwnsz,\
jrziranv,\
jnmzomnsx,\
jnmzoqqsx,\
TABLESAMPLE_PERCENTAGE 2202H,\
TABLESAMPLEpkswBASEqs,\
!cdtrmxrotcnn,\
RESULTpoqdpi,\
owmjINTERNAL,\
owmjCONCURRENCYqd,\
owmjRUNTIME,\
owmjTIMEZONE,\
owmjKEYWORD,\
owmjpaouoq,\
owmjmloc,\
owmjqm,\
fsppgPARTIALLYuj,\
tyEXECUTIONamtWITHINspORvgORrg,\
jnazw,\
ncmdynnr,\
mbPREFIXniama,\
fmesqSTANDARDni,\
wyhzdmxxe,\
olplhPROXYrh,\
olplhPROXY,\
jnootolmi,\
obrqZSTDe,\
obqre,\
jbnanvnzof,\
jssnabof,\
jnanvnzfssof,\
sqSCALARsbASni,\
osocAGG,\
otosnjvy,\
rxvyqpDIMENSIONS,\
qovyqm,\
!cdvzmlmxsf,\
TPmdsmMTLnjDL,\
wzrnsoHANDOFF_BUSY,\
@6400,\
rrOFFLINEnyqh,\
!cdrrOFFLINEnyno,\
jnthotox,\
jntnvwnsx,\
jntENCODINGsx,\
jntnvocnpsx,\
jntofsx,\
jmgncATTRsx,\
jntOBJpdsx,\
jhSEGMENTSnf,\
jntnvnmzo,\
piqpREGULARpgysqd,\
snANALYZEnanzqkama 0A000,\
sqDML_DYNAMICvp,\
DEPRECATEsqCOMPOSABLEpcnc,\
obnab,\
obBLOBnmvf,\
hsdPLANox,\
jCPnmsjCHANGES,\
jCPaENABLED,\
jCPhvyxv,\
jCPhvsny,\
!cdjCPmuwlny,\
jCPxcmi,\
jntbow,\
jvynmsjENTRIES,\
obqrpbENCLOSED_BYoy,\
CMD_NEED_SUPER_ORmzugtsou,\
syry,\
bsylCONTEXT,\
bsyCOMBINATION,\
fREDACTED_PRIVILEGES,\
bOUTERts,\
LIBRARIESama,\
jfSUMMARY,\
jfsstvnrDELIMITERS,\
LIBRARYb,\
mdzxndISOLATION,\
jsibyy,\
jbmnlvy,\
jfvyLOSSYqm,\
jntTRUNCATIONe,\
jntPAGE_CHUNKf,\
jntnmsjCHUNKS,\
olplFIREWALL 28000,\
jDECOMPRESSIONsx,\
nxbmhmfxn,\
nxALGO_TEMPTABLEama,\
nxnjpqoeama,\
nxbmhsqSIMPLEogama,\
nxbmhCTEama,\
nxbmhGROUPBYama,\
nxbmhnqneama,\
nxbmhqdama,\
nxbmhORDERBYama,\
nxbmhMULTIqsama,\
nxbmhhWHEREtolSUBOBJECT,\
nxbmhWHEREtolROOTOBJECT,\
nxbmhmfWHEREnzodSUBOBJECT,\
nxbmhmfokoc,\
nxbmhCONTEXT_PREPAREmi,\
nxbmhhnatalROOT,\
nxbmhMUSTBEnataodSINGLETON,\
nxbmhMUSTBEnataodyw,\
nxbmhhnaOBJlARRAYAGG,\
nxbmhRELATIONSHIP_RULES_VIOLATED,\
nxbmhmgocama,\
nxbmhsqBASEgama,\
nxbmhgptPKox,\
nxbmhgptPK_PROJECTIONox,\
nxbmhIDnisbBYaROOTg,\
nxbmhIDniasbBY_ROOTg,\
nxbgxnodSINGLETON_OBJ,\
nxbgxnodywOBJ,\
nxbmhpmKEYSama,\
nxbmhpmmgama,\
nxbmhwggqcPROJECTION,\
nxbmhmgtwama,\
nxbmhqcgoklTHEta,\
nxbmhWHERE_USESsqIMMEDIATExe,\
nxbmhCOMPOSITEnisb,\
nxbmhALIASasbodwgqs,\
nxmwama 0A000,\
nxohORzyama,\
nxbnaDUALITYtaUSAGE,\
nxpbnaoc,\
nxtmnisaynPROVIDED,\
nxJOINtoaSATISFIED,\
nxPK_DUPLICATESaIDENTICAL,\
nxUNMAPPEDni,\
nxmuutTAG,\
nxmuydSUBOBJECT,\
nxJOINtoVIOLATION,\
nxmuETAG,\
nxETAGnp,\
nxmumn,\
nxPK_UPDATESamt,\
nxmuooTAG,\
nxmuuqTAG,\
nxqzutmn,\
nxutmnaFIXED,\
nxqzoomn,\
nxoomnaFIXED,\
!cdnxueEDITIONqd,\
nxmdynsbnj,\
nxDMLwe,\
!cdnxmumnodAGmg,\
nxbBINARYocsz,\
ETAGama,\
ncqluh,\
vznzama,\
vzgboe,\
vzgncama,\
vzgncawx,\
jhwloxhzanvPRIV,\
jvhngmu,\
jvhngpm,\
jntOCI_GENAIop,\
jntufnvwnsx,\
nxEXPLICITqjtqamt,\
jssvhngnp,\
jDELTAofnp,\
jDELTAukpde,\
jDELTAmle,\
fACCOUNT_TRIMMED,\
jfxxpcxutv,\
jGENCOLe,\
TEMPORALneul 22008,\
jssmgqpsx,\
jEXTRAtjlnv,\
jrzCOMPLEXqm,\
mqkpu,\
mqkmjnaqezwe,\
mqkmiqoraqs,\
mqkmiqorag,\
mqkmjnaqengmdynpr,\
mqkmjnongboy,\
mqkhpfINSTALLED,\
mqkmjmdpdmv,\
mqkmjzingboy,\
mqkmjnanongmdynpr,\
mqkmjpfIDrkmnunb,\
mqkmjrgbphoc,\
mqkmjrgbphsr,\
mqkABORT,\
mqkCOULDaRELOADvm,\
mqkrgbphqz,\
mqkqppoCLOSEqoyzswpo,\
mqkqppotuPRUNE_SECONDS_PRECEDENCE,\
mqkmvHASaBEENpa,\
mqkbgmh,\
mqkmjqemiqoxvgFLDS,\
mqkmjqemiqozjgodpd,\
mqkmjqemiqouqFROMg,\
mqknaqesuarpno,\
jCUSTOMotPLACEMENT_OVERRIDES,\
jsiwlotocnp,\
mqkmjbqeABORT,\
mqkmjnabqemdynsb,\
fmqkvmb,\
nxnftuEXPLICIT_PKSamt,\
psqgmje,\
psqgrvnk ,\
psqgEXPECTS_CASE ,\
psqgEXPECTS_CASEtg ,\
psqgmuELSE ,\
psqgONEtgwa ,\
psqgsaRETURNph ,\
psqgbGATEKEEPER ,\
psqgsqLITERAL_GATEKEEPER_ARG ,\
psqgvoCONSTRUCT ,\
psqgbmgts ,\
psqgosmgue ,\
psqgosTYPES ,\
psqgsqDETERMINISTICtf ,\
wyqpqslCASCADE_CHAINpi,\
wyCASCADExlUPDATINGwytjama,\
ioosbglwyCASCADE,\
fpaOPERATIONSyq,\
nxpbbmn,\
@6900,\
zhmprbqk,\
zhrbWORKERsrrotcnn,\
zhrbWORKERsrpkodCSA,\
CSAmlUNTIL_COND,\
zhrboiMEMORYqdpkodCSA,\
fzhrboiMEMORYqdrotcnn,\
CSAzhDELAYEDrbama,\
CSAzhREQUIREMENTqqnz,\
CSAzhREQUIREMENTmmpk,\
xqmdwwptmc,\
mkIDENTITYuh,\
obrqviunDIRECTORY,\
nxmgTAGamaodyf,\
nxoomgTAGamaodPK`
