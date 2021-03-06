package com.ilmservice.personalbudget.events;

import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedList;
import java.util.Locale;
import java.util.Map;
import java.util.Scanner;
import java.util.function.BiConsumer;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;

import com.ilmservice.personalbudget.data.IEventStore;
import com.ilmservice.personalbudget.data.ITransactionCategoryStore;
import com.ilmservice.personalbudget.data.ITransactionStore;
import com.ilmservice.personalbudget.protobufs.Data;
import com.ilmservice.personalbudget.protobufs.Data.Color;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Data.TransactionCategory;
import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.personalbudget.protobufs.Events.SpreadsheetRow;
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;

@Default
@Stateless
public class SpreadsheetUploadEventHandler implements ISpreadsheetUploadEventHandler {
	
	@Inject private IEventStore eventStore;
	@Inject private ITransactionCategoryStore transactionCategoryStore;
	
	private SpreadsheetParser[] parsers;
	private Pattern bremerTimeRegex;
	private Pattern bremerDateRegex;
	private Pattern bremerCardRegex;
	private Pattern bremerPosRegex;
	private Pattern bremerMerchantRegex;
	private Pattern bremerPurchaseRegex;
	private Pattern bremerTerminalRegex;
	
	private final float goldenRatio = 1.61803f;
	private final double nonCorrelatedSineFudgeFactor = 0.6934d;
	private Map<String, TransactionCategory> categoriesByName;
	
	SpreadsheetUploadEventHandler () {
		
		bremerTimeRegex = Pattern.compile("\\d{1,2}:\\d{2} +(AM|PM)");
		bremerDateRegex = Pattern.compile("\\d ?\\d- ?\\d ?\\d- ?\\d\\d");
		bremerCardRegex = Pattern.compile("X[ X]{5,20}(\\d{1,10})");
		bremerPosRegex = Pattern.compile("(^POS )|( POS )");
		bremerMerchantRegex = Pattern.compile("(^MERCHANT )|( MERCHANT )");
		bremerPurchaseRegex = Pattern.compile("(^PURCHASE )|( PURCHASE )");
		bremerTerminalRegex = Pattern.compile("(^TERMINAL )|( TERMINAL )");
		
		categoriesByName = new HashMap<String, TransactionCategory>();
		
		parsers = new SpreadsheetParser[] {
			new SpreadsheetParser(
				UploadSpreadsheetEvent.SpreadsheetSource.BREMER,
				"<Date><CheckNum><Description><Withdrawal Amount><Deposit Amount><Additional Info>",
				1,
				(row) -> {
					Transaction.Builder builder = Transaction.newBuilder();
					float outDollars;
					float inDollars;
					int checkNumber;
					try(Scanner outDollarsScanner = new Scanner(row.getFields(3))) {
						outDollars = outDollarsScanner.hasNextFloat() ? outDollarsScanner.nextFloat() : 0f;
					}
					try(Scanner inDollarsScanner = new Scanner(row.getFields(4))) {
						inDollars = inDollarsScanner.hasNextFloat() ? inDollarsScanner.nextFloat() : 0f;
					}
					try(Scanner checkNumberScanner = new Scanner(row.getFields(1))) {
						checkNumber = checkNumberScanner.hasNextInt() ? checkNumberScanner.nextInt() : -1;
					}
					
					String description = row.getFields(5);
					
					Matcher timeMatch = bremerTimeRegex.matcher(description);
					String descriptionTime = timeMatch.matches() ? timeMatch.group() : "12:00 AM";
					description = timeMatch.replaceAll("");
					
					Matcher dateMatch = bremerDateRegex.matcher(description);
					description = dateMatch.replaceAll("");
					
					Matcher cardMatch = bremerCardRegex.matcher(description);
					String descriptionCard = cardMatch.matches() ? cardMatch.group(1) : null;
					description = cardMatch.replaceAll("");
					
					// remove common terms from the description to avoid noise in the keyword index.
					description = bremerPosRegex.matcher(description).replaceAll("  ");
					description = bremerMerchantRegex.matcher(description).replaceAll("  ");
					description = bremerPurchaseRegex.matcher(description).replaceAll("  ");
					description = bremerTerminalRegex.matcher(description).replaceAll("  ");
				
					try {
						builder.setCents(Math.round((inDollars+outDollars)*100f));
						builder.setDate(
							new SimpleDateFormat("MM/dd/yyyy h:mm a", Locale.ENGLISH)
								.parse(row.getFields(0) + " " + descriptionTime).getTime()
						);
						builder.setDescription(new StringBuilder()
								.append(row.getFields(2)).append(" ")
								.append(description)
								.append(checkNumber != -1 ? " " + checkNumber : "")
								.toString());
						if(descriptionCard != null) {
							builder.setCard(descriptionCard);
						}
						if(checkNumber != -1) {
							builder.setCheckNumber(checkNumber);
						}
					} catch (Exception e) {
						throw new RuntimeException(e);
					}
					return builder.build();
				}
			),
			new SpreadsheetParser(
					UploadSpreadsheetEvent.SpreadsheetSource.GNUCASH_ASSET_EXPORT,
					"DateAccount NameNumberDescriptionNotesMemoCategoryTypeActionReconcileTo With SymFrom With SymTo Num.From Num.To Rate/PriceFrom Rate/Price",
					1,
					(row) -> {
						//System.out.println("" + (row.hasIndex() ? row.getIndex() : -1));
						if(row.hasIndex() && row.getIndex() % 3 == 1) {
							String account = row.getFields(1);
							//System.out.println(account);
							
							if(account.equals("fidelity") || account.equals("Bremer") || account.equals("AmericanFunds")) {
								SpreadsheetRow.Builder newRow = SpreadsheetRow.newBuilder();
								newRow.addFields(row.getFields(0)); // date
								newRow.addFields(row.getFields(2)); // check num
								newRow.addFields(row.getFields(3)+" "+row.getFields(4)); //description
								String partialCategory = row.getFields(6);
								String category = account+":"+partialCategory;
								float dollars = 0f;
								String dollarsString = row.getFields(10).replace("$", "").replace(",", "");
								try(Scanner dollarsScanner = new Scanner(dollarsString)) {
									dollars = dollarsScanner.hasNextFloat() ? dollarsScanner.nextFloat() : 0f;
								}
								if(account.equals("AmericanFunds") || account.equals("fidelity")) {
									category = "payroll:401k"; 
									dollars = -dollars;
							    }
								newRow.addFields(category);
								newRow.addFields(NumberFormat.getInstance().format(dollars));
								
								//System.out.println(newRow.getFields(0) + ", " + newRow.getFields(1) + ", " + newRow.getFields(2) + ", " + newRow.getFields(3) + ", " + newRow.getFields(4));
								
								return this.basicMapper(newRow.build());
						    }
						}
						return null;
					}
				),
			new SpreadsheetParser(
					UploadSpreadsheetEvent.SpreadsheetSource.GNUCASH_CUSTOM,
					"DateCheck NumberDescriptionCategoryDollars",
					1,
					this::basicMapper
				)
		};
	}
	
	@Override
	public TransactionList uploadSpreadsheet(Event event) throws Exception {
		
		UploadSpreadsheetEvent spreadsheet = event.getUploadSpreadsheetEvent();
		
		if(spreadsheet == null) {
			throw new Exception("SpreadsheetUploadEventHandler: spreadsheet is null.");
		}
		 
		eventStore.put(event);
		
		SpreadsheetParser parser = getParser(spreadsheet);
		
		//System.out.println(parser.headers);
		
		return TransactionList.newBuilder().addAllTransactions(
			() ->
			getRowsStream(spreadsheet)
			.skip(parser.skip)
			.map(parser.mapper)
			.filter(x -> x != null)
			.iterator() 
		).build();
	}

	private Transaction basicMapper (SpreadsheetRow row) {  
		Transaction.Builder builder = Transaction.newBuilder();
		float dollars;
		int checkNumber;
		try(Scanner dollarsScanner = new Scanner(row.getFields(4))) {
			dollars = dollarsScanner.hasNextFloat() ? dollarsScanner.nextFloat() : 0f;
		}
		try(Scanner checkNumberScanner = new Scanner(row.getFields(1))) {
			checkNumber = checkNumberScanner.hasNextInt() ? checkNumberScanner.nextInt() : -1;
		}
		
		String description = row.getFields(2);
		
		String categoryName = row.getFields(3);
		
		if(categoriesByName.keySet().isEmpty()) {
			transactionCategoryStore.withStream(
					(s) -> s.collect(
							() -> { return categoriesByName; }, 
							(map, category) -> { 
								map.compute(category.getName(), (k, v) -> category);
							}, 
							Map::putAll
						)
				);
		}
		
		if(!categoriesByName.containsKey(categoryName)) {
			int colorId = categoriesByName.keySet().size()+1;
			float fluctuation = (float)Math.sin(nonCorrelatedSineFudgeFactor*colorId);
			float fluctuation2 = (float)Math.sin(nonCorrelatedSineFudgeFactor*goldenRatio*colorId);
			TransactionCategory newCategory = 
					TransactionCategory.newBuilder()
					.setColor(
							Color.newBuilder()
							.setH((goldenRatio * colorId) % 1)
							.setS(0.65f + fluctuation*0.3f)
							.setV(0.7f + fluctuation2*0.3f)
						)
					.setName(categoryName)
					.setId(categoriesByName.keySet().size()+1)
					.build();
			
			try {
				categoriesByName.put(categoryName, transactionCategoryStore.put(newCategory));
			} catch (Exception e) {
				e.printStackTrace();
			}
		}
		
		try {
			builder.setCategoryId(categoriesByName.get(categoryName).getId());
			builder.setCents(Math.round((dollars)*100f));
			builder.setDate(
				new SimpleDateFormat("MM/dd/yyyy", Locale.ENGLISH)
					.parse(row.getFields(0)).getTime()
			);
			builder.setDescription(description);
			if(checkNumber != -1) {
				builder.setCheckNumber(checkNumber);
			}
		} catch (Exception e) {
			throw new RuntimeException(e);
		}
		return builder.build();
	}
	
	
	private Stream<SpreadsheetRow> getRowsStream(UploadSpreadsheetEvent spreadsheet) {
		return spreadsheet.getRowsList()
			.stream()
			.filter(
				(row) -> row.getFieldsList()
					.stream()
					.anyMatch((field) -> {return field.length() > 0;})
			);
	}
	
	private SpreadsheetParser getParser(UploadSpreadsheetEvent spreadsheet) throws Exception {
		String headersConcat = String.join("", 
			getRowsStream(spreadsheet).findFirst().get().getFieldsList()
		);
		
		for(SpreadsheetParser parser : this.parsers) {
			if(parser.headers.equalsIgnoreCase(headersConcat) || spreadsheet.getSource() == parser.source) {
				return parser;
			}
		}
		
		throw new Exception("SpreadsheetUploadEventHandler: Unable to determine spreadsheet type.");
	}
	
	class SpreadsheetParser {
		public final UploadSpreadsheetEvent.SpreadsheetSource source;
		public final String headers;
		public final int skip;
		public final Function<SpreadsheetRow, Transaction> mapper;
		
		private SpreadsheetParser (
				UploadSpreadsheetEvent.SpreadsheetSource source,
				String headers, 
				int skip,
				Function<SpreadsheetRow, Transaction> mapper
			) {
			this.source = source;
			this.headers = headers;
			this.skip = skip;
			this.mapper = mapper;
		}
	}
}
