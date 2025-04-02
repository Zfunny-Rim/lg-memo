define(["jquery", "qlik", "./cryptoJs.min"], function ($, qlik, CryptoJS) {
	// 유틸 함수: Qlik 변수 가져오기
	function getVariableContent(name) {
		const app = qlik.currApp();
		//console.log(name);
		const promise = new Promise((resolve, reject) => {
			app.variable.getByName(name).then((variableModel) => {
				if (!variableModel || !variableModel.id) {
					reject(new Error("Variable not found: " + name));
					return;
				}

				variableModel.getLayout().then((layout) => {
					//console.log("layout :", layout);
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
	function validateVSearch(vSearch, actionType, reportNm) {
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
			reliability: ["basisYm", "closeDivisionSeqKcd", "userId"],
			qcost_create: ["reportNm", "yyyyMm", "company", "gbu1", "gbu2", "gbu3", "division", "region", "prodAff", "userId"],
			qcost_update: ["surKey", "userId"]
		};

		const requiredKeys = schema[actionType];

		if (!requiredKeys) {
			return {
				valid: false,
				reason: `Unknown actionType: ${actionType}`
			};
		}
		
		 // 3. 필수 필드 존재 확인
		if(actionType === "qcost_create"){
			const detailCheck =  validateQCostCreate(parsed, reportNm);
			if (!detailCheck.valid) {
				return{
					valid: false,
					reason: detailCheck.reason
				}
			}
		}else{
			const missingKeys = requiredKeys.filter(
				key => !parsed[key] || parsed[key].toString().trim() === ""
			);
			if (missingKeys.length > 0) {
				return {
					valid: false,
					reason: getMissingFieldErrorMessage(actionType, missingKeys)
				};
			}
		}

		// 모두 통과
		return {
			valid: true,
			parsed 
		};
	}

	function getMissingFieldErrorMessage(actionType, missingKeys) {
		const systemErrorMessage = "A required system field is missing.";
		const noSelectionMessage = "Please select one record.";
		const prodAffMissingMessage = "Please select a Prod Affiliate.";
   		const yearMonthMissingMessage = "Please select a YearMonth.";
		const formulaErrorMessage = "Field selection formula may be invalid";
	
		const rules = {
			issue_note: {
				orGroup: ["judgeBasisSn", "surKey"],
				requiredGroup: ["basisYm", "userId"]
			},
			reliability: {
				orGroup: ["closeDivisionSeqKcd"],
				requiredGroup: ["basisYm", "userId"]
			},
			qcost_update: {
				orGroup: ["surKey"],
				requiredGroup: ["userId"]
			},
			qcost_create: {
				userRequired: ["reportNm", "userId"],
				promptRequired: ["yyyyMm", "prodAff"],
				formulaCheck: ["company", "gbu1", "gbu2", "gbu3", "division", "region"]
			}
		};
	
		const config = rules[actionType];
		
		if (actionType === "qcost_create") {
			const userMissing = config.userRequired.filter(key => missingKeys.includes(key));
			const promptMissing = config.promptRequired.filter(key => missingKeys.includes(key));
			const formulaMissing = config.formulaCheck.filter(key => missingKeys.includes(key));
	
			if (userMissing.length > 0) {
				return `${systemErrorMessage}: ${userMissing.join(", ")}`;
			}
	
			if (promptMissing.includes("prodAff")) {
				return prodAffMissingMessage;
			}
	
			if (promptMissing.includes("yyyyMm")) {
				return yearMonthMissingMessage;
			}
	
			if (formulaMissing.length > 0) {
				return `${formulaErrorMessage}: ${formulaMissing.join(", ")}`;
			}
	
			// 이 외는 일반 누락 필드 메시지
			return `Missing required fields: ${missingKeys.join(", ")}`;
		}


		const isOrGroupMissing = config.orGroup.some(key => missingKeys.includes(key));
		const missingRequiredFields = config.requiredGroup.filter(key => missingKeys.includes(key));


		if (missingRequiredFields.length > 0 ) {
			return `${systemErrorMessage}: ${missingRequiredFields.join(", ")}`;
		}
	
		if (isOrGroupMissing) {
			return noSelectionMessage;
		}
	
		return `Missing required fields: ${missingKeys.join(", ")}`;
	}
	
	
	function validateQCostCreate(vSearchObj, reportNm) {
		const requiredAlways = ["userId", "yyyyMm"];
		const orgHierarchy = ["company", "gbu1", "gbu2", "gbu3", "division"];

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
		// MS - Audit일때만 검사한다...?
		if(reportNm === "MS - Audit"){
			if (!vSearchObj["prodAff"]){
				missing.push("prodAff");
			}
			if (vSearchObj["prodAff"] && !vSearchObj["region"]) {
				missing.push("region");
			}
		}
		
		if (missing.length > 0) {
			return {
				valid: false,
				reason: getMissingFieldErrorMessage('qcost_create', missing)
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
				styleSettings: {
					label: "Style Setting",
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
						buttonText: {
							ref: "buttonText",
							label: "Button Text",
							type: "string",
							defaultValue: ""
						},
						customCss: {
							ref: "customCss",
							label: "Button CSS",
							type: "string",
							expression: "optional",
							defaultValue: "width: 100%;height: 100%;cursor: pointer;color: #e34975;font-weight: bold;background-color: #fefafd;border: 0.135px solid #e34975;padding: 6px 14px;border-radius: 4px;font-size: 12px;"
						},
						popWidth: {
							ref: "popWidth",
							label: "Open Window Size (width)",
							type: "number",
							defaultValue: 1600
						},
						popHeight: {
							ref: "popHeight",
							label: "Open Window Size (hegiht)",
							type: "number",
							defaultValue: 1200
						}
					}
				},
				actionSettings: {
					label: "Extension Setting",
					type: "items",
					items: {
						reportName: {
							ref: "reportNm",
							label: "Report Name (QCost)",
							type: "string",
							defaultValue: "Global Report"
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
		},
		paint: async function ($element, layout) {
			const ownId = this.options.id;
			const customCss = layout.customCss || "width: 100%;height: 100%;cursor: pointer;color: #e34975;font-weight: bold;background-color: #fefafd;border: 0.135px solid #e34975;padding: 6px 14px;border-radius: 4px;font-size: 12px;";
			const btnText = layout.buttonText || layout.actionType;
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
			$button.off('click').on('click', async function () {
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
					const endpointMap = {
						issue_note: "/qlik/issue/detail/?search=",
						reliability: "/qlik/reliability/detail/?search=",
						qcost_create: "/qlik/memo/create?search=",
						qcost_update: "/qlik/memo/modify?search="
					};
					const endpoint = endpointMap[layout.actionType];

					const validateResult = validateVSearch(vSearch, layout.actionType, layout.reportNm);
					if(!validateResult.valid){
						alert(validateResult.reason);
						return;
					}
					
					// actionType 이 qcost_create 인 경우, body의 reportNm을 layout.reportNm으로 고쳐야함.
					if (layout.actionType === "qcost_create") {
						const parsed = validateResult.parsed;
					
						// layout에서 reportNm 가져와 덮어쓰기
						if(!layout.reportNm){
							alert("Please enter the report name for QCost.");
							return;
						}
						parsed.reportNm = layout.reportNm;
						// 다시 JSON 문자열로 직렬화
						vSearch = JSON.stringify(parsed);
						console.log(vSearch)
					}
					
					const encrypted = encryptAES(vSearch, vAESKey);
					const encoded = toUrlSafeBase64(encrypted);
					const apiUri = layout.serverAddress + endpoint + encoded;
					
					const popupWidth = layout.popWidth;
					const popupHeight = layout.popHeight;

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
