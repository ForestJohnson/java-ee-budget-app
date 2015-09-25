package com.ilmservice.personalbudget.service;

import java.nio.ByteBuffer;

import javax.annotation.PostConstruct;
import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;

import com.google.protobuf.InvalidProtocolBufferException;
import com.ilmservice.personalbudget.data.IProtobufRepository;
import com.ilmservice.personalbudget.data.IProtobufRepository.IProtobufIndex;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;

@Default
@Stateless
public class EventStore implements IEventStore {

	@Inject private IProtobufRepository<Event> events;
	private IProtobufIndex<Integer, Event> eventsById;
	
	@PostConstruct
	public void configure() {
		events.configure( 
			(x) -> Event.parseFrom(x)
		);
		
		eventsById = events.configureIndex(
			"id",
			(k) -> Event.newBuilder().setId(k).build(),
			(v) -> v.getId(),
			(k) -> ByteBuffer.allocate(4).putInt(k).array()
		);
	}
	
	@Override
	public void uploadSpreadsheet(UploadSpreadsheetEvent event) {
		// TODO Auto-generated method stub
		
	}
	
	@Override
	public void close() throws Exception {
		// TODO Auto-generated method stub

	}



}
