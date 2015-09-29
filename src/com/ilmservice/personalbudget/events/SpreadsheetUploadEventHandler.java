package com.ilmservice.personalbudget.events;

import java.util.HashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Scanner;
import java.io.IOException;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.function.BiConsumer;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;

import com.ilmservice.personalbudget.data.IEventStore;
import com.ilmservice.personalbudget.data.ITransactionStore;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.personalbudget.protobufs.Events.SpreadsheetRow;
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;

@Default
@Stateless
public class SpreadsheetUploadEventHandler implements ISpreadsheetUploadEventHandler {
	
	@Inject private IEventStore eventStore;
	@Inject private ITransactionStore transactionStore;
	
	private SpreadsheetParser[] parsers;
	private Pattern bremerTimeRegex;
	private Pattern bremerDateRegex;
	private Pattern bremerCardRegex;
	private Pattern bremerPosRegex;
	private Pattern bremerMerchantRegex;
	private Pattern bremerPurchaseRegex;
	private Pattern bremerTerminalRegex;
	private SimpleDateFormat bremerDateFormat;
	
	SpreadsheetUploadEventHandler () {
		
		bremerTimeRegex = Pattern.compile("\\d{1,2}:\\d{2} +(AM|PM)");
		bremerDateRegex = Pattern.compile("\\d ?\\d-\\d ?\\d-\\d\\d");
		bremerCardRegex = Pattern.compile("X[ X]{5,20}(\\d{1,10})");
		bremerPosRegex = Pattern.compile("(^POS )|( POS )");
		bremerMerchantRegex = Pattern.compile("(^MERCHANT )|( MERCHANT )");
		bremerPurchaseRegex = Pattern.compile("(^PURCHASE )|( PURCHASE )");
		bremerTerminalRegex = Pattern.compile("(^TERMINAL )|( TERMINAL )");
		bremerDateFormat = new SimpleDateFormat("MMMM d, yyyy", Locale.ENGLISH);
		
		parsers = new SpreadsheetParser[] {
			new SpreadsheetParser(
				UploadSpreadsheetEvent.SpreadsheetSource.BREMER,
				"<Date><CheckNum><Description><Withdrawal Amount><Deposit Amount><Additional Info>",
				1,
				(builder, row) -> {
					float outDollars;
					float inDollars;
					try(Scanner outDollarsScanner = new Scanner(row.getFields(3))) {
						outDollars = outDollarsScanner.hasNextFloat() ? outDollarsScanner.nextFloat() : 0f;
					}
					try(Scanner inDollarsScanner = new Scanner(row.getFields(4))) {
						inDollars = inDollarsScanner.hasNextFloat() ? inDollarsScanner.nextFloat() : 0f;
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
				
					
					builder
						.setCents(Math.round((inDollars+outDollars)*100f))
						.setDate(bremerDateFormat.parse(row.getFields(0) + descriptionTime).getTime());
				}
			)
		};
	}
	
	@Override
	public void uploadSpreadsheet(Event event) throws Exception {
		
		UploadSpreadsheetEvent spreadsheet = event.getUploadSpreadsheetEvent();
		
		if(spreadsheet == null) {
			throw new Exception("SpreadsheetUploadEventHandler: spreadsheet is null.");
		}
		 
		eventStore.toString();
		
		SpreadsheetParser parser = getParser(spreadsheet);
		
		getRowsStream(spreadsheet)
			.skip(parser.skip)
			.map((row) -> {
				Transaction.Builder builder = Transaction.newBuilder();
				parser.mapper.accept(builder, row);
				return builder;
			}).forEach((builder) -> transactionStore.put(builder));
			
	
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
			if(parser.headers == headersConcat || spreadsheet.getSource() == parser.source) {
				return parser;
			}
		}
		
		throw new Exception("SpreadsheetUploadEventHandler: Unable to determine spreadsheet type.");
	}
	
	@FunctionalInterface
	public interface ParseFunction<T, R> {
	    void accept(T t, R r) throws ParseException;
	}
	
	class SpreadsheetParser {
		public final UploadSpreadsheetEvent.SpreadsheetSource source;
		public final String headers;
		public final int skip;
		public final ParseFunction<Transaction.Builder, SpreadsheetRow> mapper;
		
		private SpreadsheetParser (
				UploadSpreadsheetEvent.SpreadsheetSource source,
				String headers, 
				int skip,
				ParseFunction<Transaction.Builder, SpreadsheetRow> mapper
			) {
			this.source = source;
			this.headers = headers;
			this.skip = skip;
			this.mapper = mapper;
		}
	}
}
