define(["jquery", "qlik", "./cryptoJs.min"], function ($, qlik, CryptoJS) {
	// 유틸 함수: Qlik 변수 가져오기
	function getVariableContent(name) {
		const app = qlik.currApp();
		console.log(name);
		const promise = new Promise((resolve, reject) => {
			app.variable.getByName(name).then((variableModel) => {
				if (!variableModel || !variableModel.id) {
					reject(new Error("Variable not found: " + name));
					return;
				}

				variableModel.getLayout().then((layout) => {
					console.log("layout :", layout);
					if (layout?.qText != null){
						resolve(layout.qText);
					} else {
						reject(new Error("Variable has no calculated value: " + name));
					}
				}).catch((err) => {
					reject(new Error(`getLayout() failed: ${err.message}`));
				});

			}).catch((err) => {
				reject(new Error(`Variable not found : ${name}`));
			});
		});
		
		return promise;
	}

	// 암호화
	function encryptAES(text, key16) {
		if (typeof key16 !== "string" || key16.length < 16) {
			throw new Error("AES key must be a string with at least 16 characters.");
		}
		
		const key = CryptoJS.enc.Utf8.parse(key16);
		const iv = CryptoJS.enc.Utf8.parse(key16.substring(0, 16));
		const encrypted = CryptoJS.AES.encrypt(text, key, {
			iv: iv,
			mode: CryptoJS.mode.CBC,
			padding: CryptoJS.pad.Pkcs7
		});
		return encrypted.toString();
	}

	// 복호화
	function decryptAES(encryptedText, key16) {
		const key = CryptoJS.enc.Utf8.parse(key16);
		const iv = CryptoJS.enc.Utf8.parse(key16.substring(0, 16));
		const decrypted = CryptoJS.AES.decrypt(encryptedText, key, {
			iv: iv,
			mode: CryptoJS.mode.CBC,
			padding: CryptoJS.pad.Pkcs7
		});
		return decrypted.toString(CryptoJS.enc.Utf8);
	}
	
	//json 구조 검증
	function validateVSearch(vSearch, actionType) {
		let parsed;

		// 1. JSON 파싱 확인
		try {
			parsed = JSON.parse(vSearch);
		} catch (e) {
			return {
				valid: false,
				reason: "The value of vSearch is not a valid JSON format."
			};
		}

		// 2. actionType별 요구 구조 정의
		const schema = {
			issue_note: ["basisYm", "judgeBasisSn", "surKey", "userId"],
			reliability: ["basisYm", "judgeBasisSn", "surKey", "userId"],
			qcost_create: ["reportNm", "yyyyMm", "company", "gbu1", "gbu2", "gbu3", "division", "region", "prodAff", "userId"],
			qcost_update: ["surKey", "userId"]
		};

		const requiredKeys = schema[actionType];

		if (!requiredKeys) {
			return {
				valid: false,
				reason: `Unknwon actionType: ${actionType}`
			};
		}
		
		 // 3. 필수 필드 존재 확인
		if(actionType === "qcost_create"){
			const detailCheck =  validateQCostCreate(parsed);
			if (!detailCheck.valid) {
				return{
					valid: false,
					reason: detailCheck.reason
				}
			}
		}else{
			const missingKeys = requiredKeys.filter(key => !(key in parsed));
			if (missingKeys.length > 0) {
				return {
					valid: false,
					reason: `Missing required fields: ${missingKeys.join(", ")}`
				};
			}
		}

		// 모두 통과
		return {
			valid: true,
			parsed // 필요시 파싱된 객체 반환
		};
	}
	
	function validateQCostCreate(vSearchObj) {
		const requiredAlways = ["reportNm", "yyyyMm", "userId"];
		const orgHierarchy = ["company", "gbu1", "gbu2", "gbu3", "division"];
		const regionHierarchy = ["region", "prodAff"];

		const missing = [];

		// 1. 고정 필드 검증
		requiredAlways.forEach(key => {
			if (!vSearchObj[key]) missing.push(key);
		});

		// 2. 조직 계층 검증 (하위가 있으면 상위가 있어야 함)
		for (let i = orgHierarchy.length - 1; i > 0; i--) {
			const current = orgHierarchy[i];
			const parent = orgHierarchy[i - 1];

			if (vSearchObj[current] && !vSearchObj[parent]) {
				missing.push(parent);
			}
		}

		// 3. 지역 계층 검증
		if (vSearchObj["prodAff"] && !vSearchObj["region"]) {
			missing.push("region");
		}

		if (missing.length > 0) {
			return {
				valid: false,
				reason: `Missing required fields: ${[...new Set(missing)].join(", ")}`
			};
		}

		return { valid: true };
	}

	
	// URL-SAFE Base64
	function toUrlSafeBase64(base64){
		return base64
			.replace(/\+/g, '-')   // '+' → '-'
			.replace(/\//g, '_')   // '/' → '_'
			.replace(/=+$/, '');   // '=' 제거
	}

	// 확장 정의
	return {
		support: {
			snapshot: false,
			export: false,
			exportData: false
		},
		initialProperties: {
			showTitles: false,
			disableNavMenu: true,
			showDetails: false
		},
		definition: {
			type: "items",
			component: "accordion",
			items: {
				appearance: {
					label: "Options",
					type: "items",
					items: {
						actionType: {
							ref: "actionType",
							label: "Action Type",
							type: "string",
							component: "dropdown",
							options: [
								{ value: "issue_note",     label: "Issue Note" },
								{ value: "reliability", label: "Reliability" },
								{ value: "qcost_create",     label: "Create Quality Cost" },
								{ value: "qcost_update",     label: "Update Quality Cost" }
							],
							defaultValue: "issue_note"
						},       
						actionSettings: {
							label: "Custom Setting",
							type: "items",
							items: {
								buttonText: {
									ref: "buttonText",
									label: "Button Text",
									type: "string",
									defaultValue: "Button"
								},
								customCss: {
									ref: "customCss",
									label: "Button CSS",
									type: "string",
									expression: "optional",
									defaultValue: "width: 100%;height: 100%;cursor: pointer;color: #e34975;font-weight: bold;background-color: #fefafd;border: 0.135px solid #e34975;padding: 6px 14px;border-radius: 4px;font-size: 12px;"
								},
								serverAddress: {
									ref: "serverAddress",
									label: "Server Address",
									type: "string",
									expression: "optional",
									defaultValue: "https://cqisdev.lge.com"  
								},
								vAESKeyName: {
									ref: "vAESKeyName",
									label: "vAESKey Variable Name",
									type: "string",
									defaultValue: "vAESKey"
								},
								vSearchVarName: {
									ref: "vSearchVarName",
									label: "vSearch Variable Name",
									type: "string",
									defaultValue: "vSearch"
								}
							}
						}
					}
				}
			}
		},
		paint: async function ($element, layout) {
			const ownId = this.options.id;
			const customCss = layout.customCss || "width: 100%;height: 100%;cursor: pointer;color: #e34975;font-weight: bold;background-color: #fefafd;border: 0.135px solid #e34975;padding: 6px 14px;border-radius: 4px;font-size: 12px;";
			const btnText = layout.buttonText || "LG";
			const $button = $("<button>", {
				id: ownId + "-btn",
				text: btnText,
				style: customCss
			});
			$element.empty().append($button);

			// 스타일 삽입
			$("#" + ownId).remove();
			const style = `
				div[tid="${ownId}"] .qv-object-${ownId},
				div[tid="${ownId}"] .qv-inner-object:not(.visual-cue) {
					border: none!important;
					background: none!important;
					margin: 0!important;
					padding: 0!important;
				}
				#${ownId}_title {
					display: none!important;
				}
			`;
			$("<style>", { id: ownId }).html(style).appendTo("head");

			// 클릭 이벤트
			$button.on('click', async function () {
				const app = qlik.currApp();
				const mode = qlik.navigation.getMode();
				if (mode === "edit") return;
				let vAESKey;
				let vSearch; 
				
				try {
					[vAESKey, vSearch] = await Promise.all([
						getVariableContent(layout.vAESKeyName),
						getVariableContent(layout.vSearchVarName)
					]);
				}catch(err){
					console.error(err);
					alert(err);
					return;
				}
					
				try{	
					console.log("server Address : " + layout.serverAddress);
					console.log("actionType : " + layout.actionType);
					var endpoint = "";
					switch(layout.actionType){
						case "issue_note":
							endpoint = "/qlik/issue/detail/?search="
							break;
						case "reliability":
							endpoint = "/qlik/reliability/detail/?search="
							break;
						case "qcost_create":
							endpoint = "/qlik/memo/create?search="
							break;
						case "qcost_update":
							endpoint = "/qlik/memo/modify?search="
							break;
					}
					console.log("endpoint : " + endpoint);
					
					const validateResult = validateVSearch(vSearch, layout.actionType);
					if(!validateResult.valid){
						alert(validateResult.reason);
						return;
					}
					
					
					const encrypted = encryptAES(vSearch, vAESKey);
					console.log("Encrypted: " + encrypted);
					//const encoded = encodeURIComponent(encrypted);
					const encoded = toUrlSafeBase64(encrypted);
					console.log("Encoded: " + encoded);
					const apiUri = layout.serverAddress + endpoint + encoded;
					console.log("** API URI: "+apiUri+" ** ");
					
					const decrypted = decryptAES(encrypted, vAESKey);
					console.log("Decrypted: " + decrypted);
					
					//alert(apiUri);
					const popupWidth = 1600;
					const popupHeight = 1200;

					const left = window.screenX + (window.outerWidth - popupWidth) / 2;
					const top = window.screenY + (window.outerHeight - popupHeight) / 2;

					const features = [
						`width=${popupWidth}`,
						`height=${popupHeight}`,
						`left=${left}`,
						`top=${top}`,
						"toolbar=no",
						"menubar=no",
						"scrollbars=yes",
						"resizable=yes",
						"status=no"
					].join(",");
					window.open(apiUri, "_blank", features);

				} catch (err) {
					alert(err);
					console.error("encryption failed:", err);
				}
			});

			return qlik.Promise.resolve();
		}
	};
});
